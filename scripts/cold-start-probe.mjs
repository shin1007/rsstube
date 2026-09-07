/**
 * 「PWAを開いた瞬間」だけが取りこぼしている2つを測る。
 *
 *   node --env-file=.env.local scripts/cold-start-probe.mjs [--base https://rsstube.vercel.app]
 *
 * `perf-probe.mjs` は**必ず1回捨ててから**中央値を取る（冷えた1回目には
 * 関数の起動が乗るため）。つまりあの数字は「開いてしばらく経ったあとの
 * 2回目以降」で、**アプリを開いた瞬間そのもの**（今日いちばん最初の1回・
 * 関数が本当に冷えている状態）は一度も測っていない。ここではその1回目を
 * 捨てずに見る。
 *
 * もう1つ、`requireSession()` はアクセストークンが切れていると
 * `/auth/refresh` を経由してから元の URL へ戻る（`lib/auth/guard.ts`）。
 * トークンの寿命は1時間なので、**数時間おきに開くこの使い方では
 * ほぼ毎回この経路を通る**。redirect が2回増える＝関数呼び出しが
 * 3つ（`/` → `/auth/refresh` → `/`）に増えるので、そのぶんが
 * 「開いた瞬間」にだけ乗る。perf-probe.mjs はここも測っていない
 * （生きたセッションだけを使うため）。
 *
 * どちらも本番で実際に確かめないと分からない話なので、ここは
 * **仮説を検証するための道具**として置く。数字が小さければ的外れ、
 * 大きければ次に削るところが分かる。
 */
import { sessionCookieJar } from './session-cookie.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'https://rsstube.vercel.app').replace(/\/$/, '');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) {
  console.error('NEXT_PUBLIC_SUPABASE_URL が要ります');
  process.exit(1);
}

function sessionCookieName() {
  const ref = new URL(url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

/** jar から `sb-<ref>-auth-token`（分割されていれば結合して）の生の値を取り出す。 */
function readSessionValue(jar) {
  const name = sessionCookieName();
  if (jar.has(name)) return jar.get(name);
  const chunks = [];
  for (let i = 0; ; i++) {
    const part = jar.get(`${name}.${i}`);
    if (part === undefined) break;
    chunks.push(part);
  }
  if (chunks.length === 0) throw new Error(`${name} が jar に無い（ログインに失敗している）`);
  return chunks.join('');
}

/** `guard.ts` の `sessionState()` と同じ形で読み書きする。期限だけ書き換える。 */
function withExpiredAt(raw) {
  if (!raw.startsWith('base64-')) throw new Error('想定外の Cookie 形式（base64- で始まらない）');
  const json = Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8');
  const session = JSON.parse(json);
  if (typeof session.expires_at !== 'number') throw new Error('expires_at が無い');
  // guard.ts の SKEW_SEC(30) より確実に過去にする。refresh_token は本物のまま
  // ——ここが偽物だと /auth/refresh が「更新もできない」に落ちて別のものを測ることになる。
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const encoded = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `base64-${encoded}`;
}

function jarToHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Set-Cookie を雑にではなく、名前=値の部分だけ取り出して jar にマージする。 */
function mergeSetCookies(jar, setCookies) {
  const next = new Map(jar);
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    next.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return next;
}

async function timedFetch(path, { headers = {}, redirect = 'manual' } = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers, redirect, cache: 'no-store' });
  await res.arrayBuffer();
  const ms = performance.now() - t0;
  return { res, ms };
}

console.log(`\n${BASE}\n`);

// ── 1. 生きたセッションで、捨てずに1回だけ叩く（今日の最初の1回のつもり）──
console.log('— 捨てずに1回だけ（perf-probe.mjs が毎回捨てている1回目）—');
const liveJar = await sessionCookieJar();
const liveCookie = jarToHeader(liveJar);
{
  const { res, ms } = await timedFetch('/', { headers: { cookie: liveCookie } });
  console.log(`${String(Math.round(ms)).padStart(6)}ms  / （生きたセッション・status ${res.status}）`);
}

// ── 2. 期限切れセッションで、実際にどの経路を通るか確かめながら測る ──
console.log('\n— 期限切れ → /auth/refresh → 戻る（guard.ts の3つ目の分岐）—');
const name = sessionCookieName();
const raw = readSessionValue(liveJar);
// 分割されていた場合に備えて、元の .0 .1 … は落として素の名前1本にまとめる
// （guard.ts は素の名前があればそちらを先に見るので、これで正しく読める）。
const expiredJar = new Map([...liveJar].filter(([k]) => k !== name && !k.startsWith(`${name}.`)));
expiredJar.set(name, withExpiredAt(raw));

let cookie = jarToHeader(expiredJar);
let total = 0;

const hop1 = await timedFetch('/', { headers: { cookie } });
total += hop1.ms;
const loc1 = hop1.res.headers.get('location');
console.log(`${String(Math.round(hop1.ms)).padStart(6)}ms  / → ${hop1.res.status} ${loc1 ?? '(リダイレクト無し？)'}`);

if (!loc1?.includes('/auth/refresh')) {
  console.log('  ! /auth/refresh へ飛ばなかった。期限切れの作り方が間違っている可能性がある。');
} else {
  const hop2 = await timedFetch(loc1.replace(BASE, ''), { headers: { cookie } });
  total += hop2.ms;
  const loc2 = hop2.res.headers.get('location');
  const setCookies =
    typeof hop2.res.headers.getSetCookie === 'function' ? hop2.res.headers.getSetCookie() : [];
  console.log(
    `${String(Math.round(hop2.ms)).padStart(6)}ms  /auth/refresh → ${hop2.res.status} ${loc2 ?? ''}（Cookie ${setCookies.length}本）`,
  );

  if (loc2 && setCookies.length > 0) {
    const refreshedJar = mergeSetCookies(expiredJar, setCookies);
    cookie = jarToHeader(refreshedJar);
    const hop3 = await timedFetch(loc2.replace(BASE, ''), { headers: { cookie } });
    total += hop3.ms;
    console.log(`${String(Math.round(hop3.ms)).padStart(6)}ms  ${loc2.replace(BASE, '')} → ${hop3.res.status}`);
  }

  console.log(`\n合計 ${Math.round(total)}ms（この3回の関数呼び出しぶん。DNS/TLSは含まない）`);
}

console.log(
  '\n上の「捨てずに1回だけ」と perf-probe.mjs の同じ行（温めたあとの中央値）を比べると' +
    '、コールドスタートぶんが分かる。「期限切れ」の合計が生きたセッションの1回よりだいぶ大きければ、' +
    'それが毎回の起動に乗っている。',
);
