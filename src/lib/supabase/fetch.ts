import { Agent, fetch as undiciFetch } from 'undici';

/**
 * **Supabase への HTTP 接続を、使い終わっても切らずに持っておく。**
 *
 * 実機（iPhone SE）の記録で、待ち時間の 1218〜1590ms が「DB を待つぶん」だった。
 * 手元から Supabase の REST を叩いて**間隔だけ変えて**測ると、正体が出る:
 *
 * | 前の1回からの間隔 | 1本の時間 |
 * |---|---:|
 * | 続けて | 17ms |
 * | 5秒 | 74ms |
 * | 10秒 | 96ms |
 * | 30秒 | 245ms |
 * | 60秒 | **559ms** |
 *
 * DB が遅いのではない。**空いた時間ぶん接続が切られていて、毎回 TCP と TLS を
 * 張り直している**（Supabase の REST は Cloudflare の後ろにいる）。Node の
 * 既定の keep-alive は**4秒**なので、少し間が空けば必ず張り直しになる。
 * オーナーがホーム画面から開く1回は、いつでもその「張り直し」に当たる。
 *
 * 同じ試験を接続を保つ形（`keepAlive: true`）でやると、30秒あけても **29ms**
 * だった。だからここは**接続を保つ側に倒す**。
 *
 * **Node の global fetch は触らない。** `setGlobalDispatcher` は npm の undici と
 * Node 内蔵の undici で同じものを指す保証が無く、しかもアプリ全部の fetch の
 * 挙動を変えることになる（フィードの取得は相手が何百とあるので、接続を
 * 持ち続けたくない）。Supabase のクライアントにだけ渡す。
 */

/**
 * 待ち時間より少し長く持つ。pg_cron の温めは2分毎なので、それを跨げる長さ。
 * `keepAliveMaxTimeout` は「相手が長い時間を提示してきたときの上限」。
 */
const agent = new Agent({
  keepAliveTimeout: 5 * 60_000,
  keepAliveMaxTimeout: 10 * 60_000,
  // 同時に開く本数。ページ1枚で2〜3本並べるので、少し余裕を持たせる。
  connections: 8,
});

/**
 * **`allowH2: true` を入れないこと。** 問い合わせを2本並べるので h2 なら
 * 接続1本で済むはず……と入れてみたが、手元で 45秒あけたときが
 * **995ms**（h2 なしの同じ試験は 244〜299ms）と悪化した。相手が
 * Cloudflare なので通るはずだが、通るのと速いのは別だった。
 * もう一度試すなら、**必ず間隔をあけた形で前後を測ること**。
 */

/**
 * supabase-js に渡す fetch。
 *
 * 型は DOM の `fetch` と undici の `fetch` で微妙に違う（`RequestInit` の
 * `duplex` など）ので、ここで1回だけ受け渡しの形を合わせる。
 * **中身は素の fetch と同じ**で、違うのは接続を保つことだけ。
 */
export const keepAliveFetch: typeof globalThis.fetch = ((
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1],
) => undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof globalThis.fetch;
