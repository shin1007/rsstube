/**
 * すべての画面遷移の待ち時間を、本番（または手元）で実測する。
 *
 *   node --env-file=.env.local scripts/perf-probe.mjs [--base https://rsstube.vercel.app]
 *                                                     [--runs 5] [--out perf-before.json]
 *
 * 測り方は docs/traps/perf.md の手順に合わせてある:
 *   ① 静的ファイル（proxy を通らない）で往復の下限を出す
 *   ② ログイン済みで /login を叩き、307 だけ返させて proxy だけの値を出す
 *   ③ 各ページを HTML と RSC（実際の画面遷移が取るもの）の両方で叩く
 *
 * セッションは Secret キーで作る（パスワードは要らない）。作った Cookie は
 * このプロセスの中だけに置き、ファイルには書かない。
 */
import { createClient } from '@supabase/supabase-js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = (arg('base', 'https://rsstube.vercel.app')).replace(/\/$/, '');
const RUNS = Number(arg('runs', 5));
const OUT = arg('out', null);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const owner = process.env.OWNER_USER_ID;
if (!url || !secret || !publishable || !owner) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / OWNER_USER_ID が要ります');
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

/** Secret キーでセッションを作り、@supabase/ssr が読む形の Cookie にする。 */
async function sessionCookie() {
  const { data: user } = await admin.auth.admin.getUserById(owner);
  const email = user?.user?.email;
  if (!email) throw new Error('OWNER_USER_ID のユーザーが見つかりません');

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;

  const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({
    type: 'email',
    token_hash: link.properties.hashed_token,
  });
  if (vErr) throw vErr;

  const ref = new URL(url).hostname.split('.')[0];
  const name = `sb-${ref}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(verified.session)).toString('base64url');

  // @supabase/ssr は 3180 文字を超えると .0 .1 … に割る。読む側も同じ形を期待する。
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i < value.length; i += CHUNK) {
    parts.push(`${name}.${parts.length}=${value.slice(i, i + CHUNK)}`);
  }
  return parts.join('; ');
}

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

console.log('— 下限と proxy —');
await push('静的ファイル（CDN。関数を起こさない）', '/offline.html', {});
// proxy の matcher から外してある口。関数は起きるが proxy は通らないので、
// 「関数を1回起こす費用」だけが出る。proxy の取り分はこの行との差。
await push('関数だけ（proxy を通らない・401）', '/api/debug/extract?url=x', {});
await push('proxy だけ（/login に 307 を返させる）', '/login', { cookie });

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
