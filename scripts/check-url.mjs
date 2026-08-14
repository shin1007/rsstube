/**
 * 「このURLから本文を取れるか」を確かめる。
 *
 *   npm run dev            （別の窓で動かしておく）
 *   npm run check:url -- https://example.com/article [...]
 *
 * 判定はアプリの /api/debug/extract に任せる。つまりワーカーが実際に使う関数を
 * そのまま通す。ここで独自に Readability を呼ぶと、本物と少しずつずれて
 * 「スクリプトでは取れるのにアプリでは取れない」が起きる。
 */

const urls = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (urls.length === 0) {
  console.error('使い方: npm run check:url -- <URL> [URL...]');
  process.exit(1);
}

const base = process.env.CHECK_URL_BASE ?? 'http://localhost:3000';
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET が要ります（node --env-file=.env.local か npm script 経由で）');
  process.exit(1);
}

for (const url of urls) {
  try {
    const res = await fetch(`${base}/api/debug/extract?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.log(`✗ ${url}\n   アプリが ${res.status} を返しました（dev サーバーは動いていますか）`);
      continue;
    }
    const r = await res.json();

    const mark = r.ok ? '✓' : '✗';
    console.log(`${mark} ${url}`);
    console.log(`   文字コード: ${r.charset}   Content-Type: ${r.contentType || '(なし)'}`);

    if (r.error) {
      console.log(`   取得できず: ${r.error}`);
    } else if (r.ok) {
      console.log(`   本文 ${r.length}字: ${r.preview.slice(0, 110)}…`);
    } else {
      // 200字未満は抽出失敗とみなす（同意画面やエラーページを掴んでいることが多い）。
      console.log(`   本文が短すぎます（${r.length}字）。RSSの抜粋で代用されます`);
      if (r.preview) console.log(`   取れた分: ${r.preview.slice(0, 110)}`);
    }
    console.log('');
  } catch (e) {
    console.log(`✗ ${url}\n   ${e.message}\n`);
  }
}
