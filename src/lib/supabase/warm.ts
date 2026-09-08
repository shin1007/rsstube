import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * **そのインスタンスの「DB へ問い合わせる道」を、1回だけ先に通しておく。**
 *
 * 本番で測った内訳（`/` の HTML に埋めてある `__rsstubeDataMs`＝サイドバーと
 * 一覧を取るのにかかった時間）:
 *
 * | 叩き方 | 合計 | うち DB |
 * |---|---:|---:|
 * | 匿名（＝pg_cron の温めと同じ） | 109ms | －（DB に触らない） |
 * | その直後にログイン済み（**1本目**） | 841ms | **529ms** |
 * | もう一度 | 548ms | 217ms |
 * | さらにもう一度 | 294ms | 182ms |
 *
 * **匿名の1回では、この道は一度も通らない**（guard が Cookie を見て 307 を
 * 返して終わるため）。だから次に来るオーナーの1回が 1本目の重さを払う。
 * 実機（iPhone SE・冷えた PWA 起動）だと **うち DB が 1218〜1590ms** だった。
 *
 * 一度 PostgREST へ本物の問い合わせを通しておけば、TLS も supabase-js の
 * 経路もそのインスタンスに残る。**表の中身は要らない**ので、結果は捨てる。
 *
 * **前に一度、素の `fetch` で `/rest/v1/` を叩くだけの版を入れて、効かずに
 * 戻している**（docs/traps/perf.md）。今度は supabase-js の経路をそのまま
 * 通す。効いたかどうかは `__rsstubeDataMs` で確かめること——**「入れたから
 * 速いはず」と書かないこと。**
 */

/**
 * **1インスタンスにつき1回だけ。** module のトップレベルなので、
 * 同じインスタンスが生きているあいだは残る。
 *
 * こうしておくと、未ログインで叩かれるたびに問い合わせが増えることもない
 * （`/` は誰でも叩けるので、無条件に投げると外から回数を増やせてしまう）。
 */
let warmed = false;

export function warmDataPath(): void {
  if (warmed) return;
  warmed = true;

  /**
   * **`after()` で投げること。** ここは redirect() の直前で、応答は 307 一本。
   * 前で await すると温めのぶんだけ 307 が遅れる。`after` は redirect した
   * ときも走ると Next の docs に明記がある
   * （`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`）。
   */
  after(async () => {
    try {
      // 中身は見ない。**通すこと**が目的なので、いちばん軽い RPC を1本。
      await createAdminClient().rpc('shell_data');
    } catch {
      // 失敗しても構わない。誰もこの結果を待っていない。
      // 次のインスタンスがまた1回だけ試す。
    }
  });
}
