/**
 * すべての画面遷移の待ち時間を、本番（または手元）で実測する。
 *
 *   node --env-file=.env.local scripts/perf-probe.mjs [--base https://rsstube.vercel.app]
 *                                                     [--runs 5] [--out perf-before.json]
 *
 * 測り方は docs/traps/perf.md の手順に合わせてある:
 *   ① 静的ファイル（関数を起こさない）で往復の下限を出す
 *   ② ログイン済みで /login を叩き、307 だけ返させて「ページを組まない関数」の値を出す
 *   ③ 各ページを HTML と RSC（実際の画面遷移が取るもの）の両方で叩く
 *
 * セッションは Secret キーで作る（パスワードは要らない）。作った Cookie は
 * このプロセスの中だけに置き、ファイルには書かない。
 */
import { createClient } from '@supabase/supabase-js';
import { sessionCookie } from './session-cookie.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = (arg('base', 'https://rsstube.vercel.app')).replace(/\/$/, '');
const RUNS = Number(arg('runs', 5));
const OUT = arg('out', null);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY が要ります');
  process.exit(1);
}

/** 実データの id を拾うためだけの管理クライアント。セッションは session-cookie.mjs が作る。 */
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

/** 1回叩いて TTFB と完了までを測る。 */
async function hit(path, { rsc = false, cookie = null, redirect = 'manual' } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (rsc) headers.RSC = '1';

  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers, redirect, cache: 'no-store' });
  const ttfb = performance.now() - t0;
  const body = await res.arrayBuffer();
  const total = performance.now() - t0;
  return { status: res.status, ttfb, total, bytes: body.byteLength };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function measure(label, path, opts) {
  const samples = [];
  let last = null;
  // 1回目は冷えているので捨てる（関数の起動や JWKS の取得が乗る）。
  await hit(path, opts).catch(() => {});
  for (let i = 0; i < RUNS; i++) {
    try {
      last = await hit(path, opts);
      samples.push(last);
    } catch (e) {
      console.log(`  ! ${label}: ${e.message}`);
    }
  }
  if (samples.length === 0) return null;
  const row = {
    label,
    path,
    rsc: !!opts?.rsc,
    status: last.status,
    ttfb: Math.round(median(samples.map((s) => s.ttfb))),
    total: Math.round(median(samples.map((s) => s.total))),
    kb: Math.round(median(samples.map((s) => s.bytes)) / 102.4) / 10,
  };
  console.log(
    `${String(row.total).padStart(5)}ms  (TTFB ${String(row.ttfb).padStart(4)}ms, ${String(row.kb).padStart(6)}KB, ${row.status})  ${label}`,
  );
  return row;
}

const cookie = await sessionCookie();

// 実データの id を拾う（本番と同じ DB）。
const { data: article } = await admin
  .from('articles')
  .select('id')
  .order('published_at', { ascending: false })
  .limit(1)
  .maybeSingle();
const { data: feed } = await admin.from('feeds').select('id').limit(1).maybeSingle();
const { data: media } = await admin
  .from('media')
  .select('id')
  .eq('status', 'ready')
  .limit(1)
  .maybeSingle();

console.log(`\n${BASE}  （中央値 / ${RUNS}回）\n`);

const rows = [];
const push = async (...a) => {
  const r = await measure(...a);
  if (r) rows.push(r);
};

console.log('— 下限 —');
await push('静的ファイル（CDN。関数を起こさない）', '/offline.html', {});
// 秘密で守ってある口。ページを組まずに 401 を返すので、**関数を1回起こす費用**だけが出る。
await push('関数だけ（ページを組まない・401）', '/api/debug/extract?url=x', {});
// ログイン済みで /login → 307。ログイン確認とリダイレクトだけで、ページは組まない。
// **proxy（middleware）は 2026-09-07 に外した。** それまではこの行が 124ms で、
// 上の行（43ms）との差 80ms が「器を1回起こす費用」だった（docs/traps/perf.md）。
await push('ログイン確認だけ（/login に 307 を返させる）', '/login', { cookie });

console.log('\n— ページ（HTML / 最初の1枚）—');
await push('/ 未読', '/', { cookie });
await push('/library', '/library', { cookie });
await push('/listen', '/listen', { cookie });
await push('/exports', '/exports', { cookie });
await push('/settings', '/settings', { cookie });

console.log('\n— 画面遷移（RSC / 実際に押したときに飛ぶもの）—');
await push('/ 未読', '/', { cookie, rsc: true });
await push('/ すべて', '/?view=all', { cookie, rsc: true });
await push('/ スター', '/?view=starred', { cookie, rsc: true });
await push('/ あとで', '/?view=later', { cookie, rsc: true });
if (feed) await push('/ フィード絞り込み', `/?feed=${feed.id}`, { cookie, rsc: true });
await push('/ 検索', '/?q=AI', { cookie, rsc: true });
if (article) await push('記事を開く', `/?article=${article.id}`, { cookie, rsc: true });
if (article) await push('記事を開く（すべて）', `/?view=all&article=${article.id}`, { cookie, rsc: true });
await push('/library', '/library', { cookie, rsc: true });
await push('/listen', '/listen', { cookie, rsc: true });
await push('/exports', '/exports', { cookie, rsc: true });
await push('/settings', '/settings', { cookie, rsc: true });
if (media) await push('/watch/:id', `/watch/${media.id}`, { cookie, rsc: true });

if (OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), runs: RUNS, rows }, null, 2));
  console.log(`\n→ ${OUT}`);
}
