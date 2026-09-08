import { after } from 'next/server';

/**
 * **DB へ向かう道を、未ログインの1回のうちに開けておく。**
 *
 * pg_cron の温めは Cookie を付けられない（付けると更新トークンを撒くことになる。
 * `public/sw.js` の注記）。だから温めの1回は guard が Cookie を見て 307 を返す
 * だけで終わり、**Supabase へ向かう道は冷えたまま**になる。次に来るのは
 * オーナーの本物の1回で、そこで初めて DNS・TCP・TLS・HTTP/2 を張る。
 *
 * 本番の実測（同じ日、同じ関数）:
 *
 * | 叩き方 | 合計 |
 * |---|---:|
 * | 匿名（＝pg_cron の温め）の直後にログイン済み | **813ms** |
 * | 続けてもう一度 | 491ms |
 * | さらにもう一度 | 426ms |
 *
 * **1本目だけが 400ms 重い。** オーナーがホーム画面から開く1回は、いつでも
 * この1本目である（直前に叩いているのは匿名の温めだけなので）。
 *
 * ここで投げるのは PostgREST の入口への1本だけで、**表は読まない**
 * （読めるものも無い——RLS がある）。欲しいのは接続そのもので、
 * 401 が返っても道は開く。応答は捨てる。
 */
export function warmDbPath(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;

  /**
   * **`after()` で投げること。** ここは redirect() の直前で、応答は 307 一本。
   * 前で await すると温めのぶんだけ 307 が遅れる——温めるために遅くしては
   * 本末転倒になる。`after` は redirect したときも走ると Next の docs に明記が
   * ある（`node_modules/next/dist/docs/.../after.md`）。
   */
  after(async () => {
    try {
      await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key },
        // 温めそのものが関数を長く占有しないよう、短く切る。
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      });
    } catch {
      // 失敗しても構わない。ここは「開けておければ得」だけの処理で、
      // 誰もこの結果を待っていない。
    }
  });
}
