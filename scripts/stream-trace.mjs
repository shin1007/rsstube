/**
 * **HTML のどの部分が、何ミリ秒目に届いたか**を出す。
 *
 *   node --env-file=.env.local scripts/stream-trace.mjs [base] [path]
 *   （既定: https://rsstube.vercel.app と /?view=all）
 *
 * `head-probe.mjs` が測るのは `</head>` の到着＝「CSS と JS を落とし始められる
 * 時刻」まで。こちらは**そのあと**、骨組み → 一覧 → 本文 が順に届く時刻を出す。
 * `<Suspense>` で切ったところが本当に別々に流れているかは、ここでしか見えない。
 *
 * 見つける印は画面に出ている文字そのもの（`全既読` など）。**印を変えるときは
 * 画面側と一緒に直すこと**——出なくなっても静かに `undefined` になるだけなので、
 * 「速くなった」と読み違える。
 *
 * 圧縮を切って測る（`accept-encoding: identity`）。圧縮を挟むと、送り出した
 * 時刻ではなく圧縮器が吐き出した時刻を測ることになる。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const owner = process.env.OWNER_USER_ID;
if (!url || !secret || !publishable || !owner) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / OWNER_USER_ID が要ります');
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
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
const cookie =
  `sb-${ref}-auth-token=base64-` + Buffer.from(JSON.stringify(verified.session)).toString('base64url');

const base = (process.argv[2] || 'https://rsstube.vercel.app').replace(/\/$/, '');
const path = process.argv[3] || '/?view=all';

/** 届いた文字列に最初に現れた時刻で、その部分が出た時刻とする。 */
const MARKS = {
  '骨組み': 'aria-busy',
  '一覧': '全既読',
  '本文': 'prose-rich',
};

console.log(`\n${base}${path}\n`);
for (let run = 0; run < 4; run++) {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    headers: { cookie, 'accept-encoding': 'identity' },
    cache: 'no-store',
  });
  let seen = '';
  const at = {};
  for await (const chunk of res.body) {
    seen += Buffer.from(chunk).toString('utf8');
    for (const [label, needle] of Object.entries(MARKS)) {
      if (at[label] === undefined && seen.includes(needle)) at[label] = Math.round(performance.now() - t0);
    }
  }
  // 1回目・2回目は冷えているので捨てる。
  if (run < 2) continue;
  const row = Object.entries(MARKS)
    .map(([label]) => `${label}=${at[label] ?? '—'}ms`)
    .join('  ');
  console.log(`${row}   全部=${Math.round(performance.now() - t0)}ms  ${(seen.length / 1024).toFixed(0)}KB`);
}
