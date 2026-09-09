/**
 * **オーナーの朝と同じ形**——こちらからは何も叩かず、pg_cron の温めだけが
 * 走っている状態で、ログイン済みの1本を投げる。
 *
 *   node --env-file=.env.local scripts/solo-probe.mjs [--runs 3] [--gap 200]
 *
 * `data-probe.mjs` は「匿名 → ログイン済み → …」を続けて叩くので、自分で
 * インスタンスを起こしてしまう。こちらは**間を置いて1本だけ**なので、
 * ホーム画面から開く1回に近い。見るのは合計ではなく `うちDB`。
 */
import { sessionCookie } from './session-cookie.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};

const BASE = 'https://rsstube.vercel.app';
const RUNS = arg('runs', 3);
const GAP_SEC = arg('gap', 200);

const cookie = await sessionCookie();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; i <= RUNS; i++) {
  await sleep((i === 1 ? 30 : GAP_SEC) * 1000);
  const t0 = Date.now();
  const res = await fetch(BASE + '/', { headers: { cookie }, cache: 'no-store' });
  const text = await res.text();
  const m = text.match(/__rsstubeDataMs=(\d+)/);
  console.log(
    `${i}回目（触らずに待ったあとの1本目） 合計 ${Date.now() - t0}ms  うちDB ${m ? m[1] + 'ms' : '－'}`,
  );
}
