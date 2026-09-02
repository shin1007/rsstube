/**
 * URL を一通り叩いて、4xx/5xx が出ないかだけを見る。
 *
 * 画面の見た目ではなく「開くか」を見る道具。ブラウザで1つずつ回るより速く、
 * **URL に変な値が入ったときの壊れ方**を拾える。実際にこれで4件見つかった:
 *
 *   /?view=unsummarized      … 件数の問い合わせが `summaries` を埋めておらず 500
 *   /?article=not-a-uuid     … UUID でない id が Postgres まで届いて 500
 *   /?folder=not-a-uuid      … 同上（feed も）
 *   /?q=（長すぎる語）        … PostgREST へのURLが長くなりすぎて 500
 *
 * 使い方（手元の dev に対して）:
 *   node --env-file=.env.local scripts/smoke-urls.mjs
 *   BASE=http://localhost:3111 node --env-file=.env.local scripts/smoke-urls.mjs
 *
 * ログインは Secret キーでその場のセッションを作る（メールは飛ばない。
 * lib/auth/passkey-session.ts と同じ手口）。**本番には向けないこと**
 * ——記事を開く URL を叩くので既読が付く。
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.BASE ?? 'http://localhost:3000';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: user } = await admin.auth.admin.getUserById(process.env.OWNER_USER_ID);
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: user.user.email,
});

const jar = new Map();
const session = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list) => {
      for (const c of list) jar.set(c.name, c.value);
    },
  },
});
const { error: authError } = await session.auth.verifyOtp({
  type: 'email',
  token_hash: link.properties.hashed_token,
});
if (authError) throw authError;
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

// 実在の id をひとつずつ拾う。作り物の UUID だと「無いとき」しか通らない。
const [{ data: articles }, { data: feeds }, { data: folders }] = await Promise.all([
  admin.from('articles').select('id').order('published_at', { ascending: false }).limit(1),
  admin.from('feeds').select('id').limit(1),
  admin.from('folders').select('id').limit(1),
]);
const a = articles?.[0]?.id;
const f = feeds?.[0]?.id;
const fo = folders?.[0]?.id;

const q = (s) => encodeURIComponent(s);
const paths = [];

// ふつうに通る道。
for (const v of ['unread', 'starred', 'later', 'all', 'unsummarized']) {
  paths.push(`/?view=${v}`, `/?view=${v}&sort=important`, `/?view=${v}&q=${q('厚生')}`);
  if (a) paths.push(`/?view=${v}&article=${a}`);
}
if (f) paths.push(`/?feed=${f}`, a ? `/?view=all&feed=${f}&article=${a}` : `/?feed=${f}`);
if (fo) paths.push(`/?folder=${fo}`);
paths.push('/', '/library', `/library?q=${q('厚生')}`, `/library?deep=1&q=${q('厚生')}`,
  '/library?starred=1', '/library?days=7', '/listen', '/exports', '/settings');

// 壊れた入力。**ここが本番** ——通る道だけ見ても、この種の500は見つからない。
paths.push(
  '/?article=not-a-uuid',
  '/?article=00000000-0000-0000-0000-000000000000',
  '/?folder=not-a-uuid',
  '/?feed=not-a-uuid',
  '/?view=zzz',
  '/?sort=zzz',
  `/?q=${q('%')}`,
  `/?q=${q('a,b(c)')}`,
  // Supabase の手前の WAF に弾かれる並び。技術系のフィードを読むなら普通に打つ。
  `/?q=${q("'; drop table articles;--")}`,
  `/?q=${q('あ'.repeat(500))}`,
  `/library?q=${q('a,b(c)')}`,
  '/library?page=-5',
  '/library?page=99999',
  '/library?days=abc',
);

let bad = 0;
for (const path of paths) {
  let status;
  try {
    const res = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
    await res.arrayBuffer();
    status = res.status;
  } catch (e) {
    status = `× ${e.message}`;
  }
  // 3xx は通した道（/login はログイン済みだとリダイレクトする）。
  const ok = typeof status === 'number' && status < 400;
  if (!ok) bad++;
  console.log(`${String(status).padStart(3)} ${ok ? '  ' : 'NG'} ${path}`);
}

console.log(bad === 0 ? '\nすべて開けた' : `\n${bad}件が 4xx/5xx`);
process.exit(bad === 0 ? 0 : 1);
