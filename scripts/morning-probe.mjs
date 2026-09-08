/**
 * **朝いちばんにホーム画面から開いたときの待ち時間**を、そのまま再現して測る。
 *
 *   node --env-file=.env.local scripts/morning-probe.mjs [--base https://rsstube.vercel.app]
 *                                                        [--runs 3] [--warm]
 *
 * `perf-probe.mjs` との違いはここだけ:**アクセストークンを切らせてから叩く**。
 *
 * perf-probe は毎回その場で新しいセッションを作るので、Cookie はいつも生きている。
 * ところがオーナーが実際に開くのは**一晩あけた朝**で、アクセストークンの寿命は
 * 1時間しかない。つまり本物の朝は必ずこの3本立てになる:
 *
 *     /  → 307 /auth/refresh  → 307 /  → 200
 *
 * しかも3本とも**関数が冷えている**（夜のあいだ誰も叩いていない）。
 * 本番の実測で 2215ms、温まっていれば 400ms、トークンが生きていれば 200ms
 * だった——**待ち時間の8割がコールドスタート**で、これは生きたセッションで
 * どれだけ測っても一度も見えない。速さの計測を「生きた Cookie」でだけ
 * やらないこと。
 *
 * 更新トークンはそのまま使うので、ここを走らせると**そのセッションのトークンは
 * 1回転する**（Supabase の回転の仕組み）。使い捨てのセッションを毎回作って
 * いるので、スマホやブラウザで開いているセッションには影響しない。
 */
import { sessionCookie } from './session-cookie.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const BASE = arg('base', 'https://rsstube.vercel.app').replace(/\/$/, '');
const RUNS = Number(arg('runs', 3));

const cookie = await sessionCookie();

/**
 * Cookie の中の `expires_at` だけを過去にして「一晩あけた朝」を作る。
 *
 * **更新トークンには触らない。** 触ると `/auth/refresh` が更新に失敗して
 * `/login` へ落ち、3本目が「ログイン画面」になる（速く見えるが、測っているのは
 * 別のものになる）。形は @supabase/ssr が決めているので、割れ方も向こうに
 * 合わせる（3180文字ごとに `.0` `.1` …。lib/auth/guard.ts と同じ）。
 */
function expireAccessToken(cookieStr) {
  const parts = cookieStr.split('; ').map((s) => {
    const i = s.indexOf('=');
    return [s.slice(0, i), s.slice(i + 1)];
  });
  const name = parts[0][0].replace(/\.\d+$/, '');
  const raw = parts
    .filter(([k]) => k === name || k.startsWith(`${name}.`))
    .map(([, v]) => v)
    .join('');
  if (!raw.startsWith('base64-')) throw new Error('Cookie の形が変わっています');

  const session = JSON.parse(Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8'));
  session.expires_at = Math.floor(Date.now() / 1000) - 60; // 1分前に切れた
  session.expires_in = 0;

  const encoded = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const chunks = [];
  if (encoded.length <= 3180) chunks.push([name, encoded]);
  else for (let i = 0, n = 0; i < encoded.length; i += 3180, n++) chunks.push([`${name}.${n}`, encoded.slice(i, i + 3180)]);

  const others = parts.filter(([k]) => k !== name && !k.startsWith(`${name}.`));
  return [...chunks, ...others].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 1本叩いて、返ってきた Set-Cookie を次の1本へ引き継ぐ（ブラウザと同じ動き）。 */
async function hop(url, jar) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { cookie: jar }, redirect: 'manual', cache: 'no-store' });
  const ttfb = performance.now() - t0;
  const body = await res.arrayBuffer();
  const total = performance.now() - t0;

  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const map = new Map(
      jar.split('; ').map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), s.slice(i + 1)];
      }),
    );
    for (const c of set) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      map.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
    jar = [...map].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  return { status: res.status, ttfb, total, kb: body.byteLength / 1024, loc: res.headers.get('location'), jar };
}

/** ホーム画面から `/` を開いて、止まるまで（＝200が返るまで）を1本ずつ出す。 */
async function launch(startCookie) {
  let url = `${BASE}/`;
  let jar = startCookie;
  const hops = [];
  const t0 = performance.now();

  for (let i = 0; i < 5; i++) {
    const h = await hop(url, jar);
    jar = h.jar;
    hops.push({ path: new URL(url).pathname, ...h });
    if (!h.loc) break;
    url = new URL(h.loc, BASE).toString();
  }

  return { total: performance.now() - t0, hops };
}

function show(label, { total, hops }) {
  console.log(`\n【${label}】合計 ${Math.round(total)}ms`);
  for (const h of hops) {
    console.log(
      `   ${h.path.padEnd(16)} → ${h.status}  TTFB ${String(Math.round(h.ttfb)).padStart(4)}ms  ` +
        `計 ${String(Math.round(h.total)).padStart(4)}ms  ${h.kb.toFixed(1)}KB`,
    );
  }
}

console.log(`\n${BASE}  （朝いちばんの経路）`);

if (has('warm')) {
  // 比較用に、先に両方の関数を起こしておく。
  await fetch(`${BASE}/`, { redirect: 'manual', cache: 'no-store' }).then((r) => r.arrayBuffer());
  await fetch(`${BASE}/auth/refresh?next=%2F`, { redirect: 'manual', cache: 'no-store' }).then((r) => r.arrayBuffer());
  console.log('（--warm: 先に温めました）');
}

for (let run = 0; run < RUNS; run++) {
  show(`${run + 1}回目: トークンが切れている（本物の朝）`, await launch(expireAccessToken(cookie)));
}
show('比較: トークンが生きている（日中の再訪）', await launch(cookie));

console.log(
  '\n読み方: 1本目と2本目が数百msなら関数が冷えている（＝温め方の問題）。\n' +
    '        3本目だけが重いなら、ページの組み立てかDBの問題。\n',
);
