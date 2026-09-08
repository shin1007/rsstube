/**
 * **「1本目だけ遅い」がどこまで消えたか**を、サーバー側の数字で見る。
 *
 *   node --env-file=.env.local scripts/data-probe.mjs
 *
 * ページが HTML に埋めている `__rsstubeDataMs`（サイドバーと一覧を取るのに
 * かかった時間）を読む。**ブラウザを立ち上げずにサーバー側だけを見られる**ので、
 * 温めの効き目を確かめるのはここでよい。
 *
 * 見たいのは合計ではなく**1本目と2本目の差**。匿名で1本叩いたあとに
 * ログイン済みで叩くのが、オーナーがホーム画面から開く1回と同じ形になる
 * （pg_cron の温めは Cookie を付けられないため）。
 */
import { sessionCookie } from './session-cookie.mjs';
const BASE = 'https://rsstube.vercel.app';
const cookie = await sessionCookie();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(label, headers) {
  const t0 = performance.now();
  const res = await fetch(BASE + '/', { headers, cache: 'no-store', redirect: 'manual' });
  const text = await res.text();
  const total = Math.round(performance.now() - t0);
  const m = text.match(/__rsstubeDataMs=(\d+)/);
  console.log(`${label.padEnd(30)} ${res.status}  合計 ${String(total).padStart(4)}ms  うちDB ${m ? m[1] + 'ms' : '－'}`);
}

for (let i = 1; i <= 2; i++) {
  console.log(`--- ${i}周（3分あけてから） ---`);
  if (i > 1) await sleep(180000);
  await hit('1) 匿名で1本（温めと同じ）', {});
  await hit('2) 直後にログイン済み', { cookie });
  await hit('3) もう一度', { cookie });
  await hit('4) もう一度', { cookie });
}
