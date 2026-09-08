/**
 * **ホーム画面から開いた1回**を、実際のブラウザの中で分解して測る。
 *
 *   node --env-file=.env.local scripts/cold-probe.mjs [--expire] [--slow]
 *
 *     --expire  アクセストークンを切らせる（＝しばらく開いていない状態。
 *               `/` →(307)→ `/auth/refresh` →(307)→ `/` の3本立てになる）
 *     --slow    CPU を4倍遅く・待ち時間 70ms にする（スマホの当たり）
 *
 * `morning-probe.mjs` との違いは**ブラウザの中で測ること**。あちらは fetch で
 * 3本を順に叩くので、リダイレクトの実費・first-paint・hydration が分からない。
 * ここでは `PerformanceNavigationTiming` を読むので、待ち時間が
 * 「往復のぶん」なのか「組み立てのぶん」なのかが分かれる（実測では、
 * トークンが切れているときの増分 327ms のうち 303ms がリダイレクトだった）。
 *
 * **1回目の goto はサービスワーカーと静的キャッシュを入れるためだけ**に走らせる
 * ——インストール済みの PWA を再現するため。測るのは2回目。
 *
 * **これは Chromium で、iPhone ではない。** サービスワーカーの起動ぶんと
 * navigationPreload の有無（WebKit は未対応）は、ここには出てこない。
 * docs/traps/perf.md の「navigationPreload に対応していない唯一のブラウザが
 * iPhone」を読むこと。
 *
 * セッションは Secret キーで作る（パスワードは要らない）。Cookie はこの
 * プロセスの中だけに置き、ファイルには書かない。
 */
import { chromium, devices } from 'playwright';
import { sessionCookie } from './session-cookie.mjs';

const BASE = 'https://rsstube.vercel.app';
const EXPIRE = process.argv.includes('--expire');

const cookieStr = await sessionCookie();

function toCookies(str, { expire }) {
  const parts = str.split('; ').map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
  const name = parts[0][0].replace(/\.\d+$/, '');
  if (expire) {
    const raw = parts.filter(([k]) => k === name || k.startsWith(name + '.')).map(([, v]) => v).join('');
    const s = JSON.parse(Buffer.from(raw.slice(7), 'base64url').toString('utf8'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60; s.expires_in = 0;
    const next = 'base64-' + Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
    const chunks = next.match(/.{1,3180}/g);
    return chunks.map((v, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: v, domain: 'rsstube.vercel.app', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }));
  }
  return parts.map(([k, v]) => ({ name: k, value: v, domain: 'rsstube.vercel.app', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone SE'],
  serviceWorkers: 'allow',
  storageState: { cookies: toCookies(cookieStr, { expire: false }), origins: [] },
});
const page = await ctx.newPage();
const THROTTLE = process.argv.includes('--slow');
async function throttle(p) {
  if (!THROTTLE) return;
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: 4*1024*1024/8, uploadThroughput: 1*1024*1024/8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

// 1回目: サービスワーカーと静的キャッシュを入れるためだけ（＝インストール済みのPWA）
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
await page.evaluate(() => navigator.serviceWorker?.ready).catch(() => {});
await page.waitForTimeout(3000);
console.log('SW:', await page.evaluate(() => !!navigator.serviceWorker?.controller));

if (EXPIRE) {
  await ctx.clearCookies();
  await ctx.addCookies(toCookies(cookieStr, { expire: true }));
}

async function measure(label) {
  const p2 = await ctx.newPage();
  await throttle(p2);
  const t0 = Date.now();
  await p2.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
  const wall = Date.now() - t0;
  const n = await p2.evaluate(() => {
    const e = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]);
    const res = performance.getEntriesByType('resource')
      .filter((r) => r.name.includes('/_next/static/'))
      .map((r) => ({ n: r.name.split('/').pop(), s: Math.round(r.startTime), e: Math.round(r.responseEnd), size: r.transferSize }));
    return {
      workerStart: Math.round(e.workerStart), fetchStart: Math.round(e.fetchStart),
      redirectCount: e.redirectCount, redirectEnd: Math.round(e.redirectEnd),
      requestStart: Math.round(e.requestStart), responseStart: Math.round(e.responseStart),
      responseEnd: Math.round(e.responseEnd), domInteractive: Math.round(e.domInteractive),
      dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd),
      transfer: e.transferSize, paint, resCount: res.length,
      resLast: Math.max(0, ...res.map((r) => r.e)),
    };
  });
  console.log(`\n【${label}】 wall ${wall}ms`);
  console.log(`  workerStart ${n.workerStart}  fetchStart ${n.fetchStart}  リダイレクト ${n.redirectCount}本 → ${n.redirectEnd}ms`);
  console.log(`  requestStart ${n.requestStart}  responseStart ${n.responseStart}  responseEnd ${n.responseEnd}  (html ${n.transfer}B)`);
  console.log(`  paint ${JSON.stringify(n.paint)}  domInteractive ${n.domInteractive}  DCL ${n.dcl}  load ${n.load}`);
  console.log(`  静的ファイル ${n.resCount}本、最後 ${n.resLast}ms`);
  await p2.close();
}

await measure(EXPIRE ? '朝（トークン切れ）' : '日中（トークン生存）');
await browser.close();
