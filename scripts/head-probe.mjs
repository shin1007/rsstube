/**
 * **`<head>` が何ミリ秒目に届くか**を測る。
 *
 *   node --env-file=.env.local scripts/head-probe.mjs [--base http://localhost:3010]
 *                                                     [--runs 3] [--paths /,/library,/listen]
 *
 * `perf-probe.mjs` が測るのは「応答が全部届くまで」で、**起動の体感はそこでは
 * なく `</head>` が届いた時刻で決まる**（そこまでブラウザは CSS も JS も
 * 落とし始められない）。動的なページを1つの async 関数で書くと、この2つが
 * 同じ時刻になる——docs/traps/perf.md の「最初の await が終わるまで
 * `<head>` すら出ない」。直したあとに戻っていないかは、ここで見る。
 *
 * セッションは Secret キーで作る（パスワードは要らない）。Cookie は
 * このプロセスの中だけに置き、ファイルには書かない。
 */
import { sessionCookie } from './session-cookie.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'https://rsstube.vercel.app').replace(/\/$/, '');
const RUNS = Number(arg('runs', 3));
const PATHS = arg('paths', '/,/library,/listen,/exports,/settings').split(',');

/** 応答を chunk ごとに読み、`</head>` を見た時刻と最後の時刻を返す。 */
async function once(path, cookie) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, cache: 'no-store' });
  let seen = '';
  let head = null;
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (head === null) {
      // 探すのは最初のぶんだけ。全部を文字にすると測っているものが変わる。
      seen += Buffer.from(chunk).toString('utf8');
      if (seen.includes('</head>')) head = performance.now() - t0;
    }
  }
  return { status: res.status, head, end: performance.now() - t0, bytes };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const cookie = await sessionCookie();
console.log(`\n${BASE}  （中央値 / ${RUNS}回）\n`);
console.log('  </head>      最後        差    パス');

for (const path of PATHS) {
  await once(path, cookie).catch(() => {}); // 1回目は冷えているので捨てる
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(path, cookie));
  const head = Math.round(median(runs.map((r) => r.head ?? r.end)));
  const end = Math.round(median(runs.map((r) => r.end)));
  console.log(
    `${String(head).padStart(6)}ms ${String(end).padStart(7)}ms ${String(end - head).padStart(7)}ms    ${path}` +
      (runs[0].status === 200 ? '' : `  (${runs[0].status})`),
  );
}
console.log('\n差が大きいほど、待っているあいだにブラウザが働けている。');
