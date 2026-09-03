import { fetchFeed } from '@/lib/feeds/parse';
import { ingestFeedItems } from '@/lib/feeds/ingest';
import { relocateFeedUrl, shouldAutoRelocate } from '@/lib/feeds/relocate';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * フィードを実際に取りに行くところ。
 *
 * **ここに置いてあるのは、入口が2つあるから。** 1つは pg_cron から1時間毎に
 * 叩かれる `/api/cron/poll`、もう1つは画面から「引っぱって更新」したとき。
 * ルートの中に書いたままだと、画面からは HTTP で自分を叩くか、同じ処理を
 * もう一組書くかしかない。後者は必ずずれる——「登録直後だけ本文抽出が
 * 積まれない」ような差は、取り込みを共有していないと必ず生まれる
 * （lib/feeds/ingest.ts に同じことが書いてある）。
 *
 * 呼ぶ側は `feeds_to_poll` で対象を選んでから渡すこと。**`feeds` を直に
 * 見ないこと**（0029。購読をやめたフィードを永久に巡回することになる）。
 */

export type PollableFeed = {
  id: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  error_count: number;
};

export type PollResult = {
  polled: number;
  skipped: number;
  failed: number;
  newArticles: number;
  states: number;
  moved: number;
};

/**
 * 渡されたフィードを順に取りに行く。
 *
 * `budgetMs` を渡すと、その時間を過ぎた時点で残りを諦める（画面から呼ぶときは
 * Server Action の実行時間に収める必要がある）。**時間で切るのはワーカーと
 * 同じ考え方**——件数だけで絞っても、1本に数十秒かかる相手がいると関数ごと落ちる。
 */
export async function pollFeeds(
  db: SupabaseClient,
  feeds: PollableFeed[],
  budgetMs?: number,
): Promise<PollResult> {
  const startedAt = Date.now();
  const now = Date.now();
  let newArticles = 0;
  let states = 0;
  let polled = 0;
  let skipped = 0;
  let failed = 0;
  let moved = 0;

  for (const [index, feed] of feeds.entries()) {
    /**
     * 時間で切る。**件数だけで絞らないこと**——1本に数十秒かかる相手がいると、
     * 関数ごと落ちて何も返らない（ワーカーで同じことを踏んでいる）。
     * 残りは「飛ばした」として数える。次の巡回が拾う。
     */
    if (budgetMs !== undefined && Date.now() - startedAt > budgetMs) {
      skipped += feeds.length - index;
      break;
    }

    // バックオフ中のフィードは飛ばす。
    if (feed.error_count > 0 && feed.last_fetched_at) {
      const waitMs = Math.min(feed.error_count, 12) * 60 * 60 * 1000;
      if (now - new Date(feed.last_fetched_at).getTime() < waitMs) {
        skipped++;
        continue;
      }
    }

    try {
      const result = await fetchFeed(feed.url, {
        etag: feed.etag,
        lastModified: feed.last_modified,
      });
      polled++;

      // フィードが恒久的に移転していたら、そちらを見るように覚え直す。
      // 覚えないと古いURLを叩き続け、それが消えた日に「死んだフィード」になる。
      if (result.movedTo && result.movedTo !== feed.url) {
        if (await moveFeedUrl(db, feed.id, result.movedTo)) moved++;
      }

      if (result.status === 'not-modified') {
        await db
          .from('feeds')
          .update({ last_fetched_at: new Date().toISOString(), error_count: 0, last_error: null })
          .eq('id', feed.id);
        continue;
      }

      // 記事の入れ方は登録直後の初回取り込みと共有する（lib/feeds/ingest.ts）。
      // 別々に書くと「登録直後だけ本文抽出が積まれない」ような差が出る。
      const ingested = await ingestFeedItems(db, feed.id, result);
      newArticles += ingested.newArticles;
      states += ingested.states;

      await db
        .from('feeds')
        .update({
          title: result.title || undefined,
          site_url: result.siteUrl ?? undefined,
          etag: result.etag ?? null,
          last_modified: result.lastModified ?? null,
          last_fetched_at: new Date().toISOString(),
          error_count: 0,
          last_error: null,
        })
        .eq('id', feed.id);
    } catch (err) {
      failed++;
      const errorCount = feed.error_count + 1;

      await db
        .from('feeds')
        .update({
          last_fetched_at: new Date().toISOString(),
          error_count: errorCount,
          last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        })
        .eq('id', feed.id);

      // リダイレクトが無いまま行方不明になった場合は、ここでしか気づけない。
      // サイトから探し直して、見つかれば付け替える（購読も既読も id に
      // 紐づいているので何も失わない）。毎回やると落ちている相手に
      // 余計なリクエストを重ねるので、続けて失敗したときだけ。
      if (shouldAutoRelocate(errorCount)) {
        const r = await relocateFeedUrl(db, feed);
        if (r.status === 'moved') {
          moved++;
          failed--; // 付け替わったので、この巡回は失敗として数えない。
        }
      }
    }
  }
  return { polled, skipped, failed, newArticles, states, moved };
}

/**
 * 移転先を覚え直す。
 *
 * feeds.url は一意なので、移転先が既に別の行として登録されていることがある
 * （移転前と移転後を両方購読していた場合）。その時は書き換えられないので何もしない。
 * 古いほうは記事が来なくなり、「更新なし」として設定画面に出るので、そこで気づける。
 */
async function moveFeedUrl(db: SupabaseClient, feedId: string, to: string): Promise<boolean> {
  const { data: taken } = await db.from('feeds').select('id').eq('url', to).maybeSingle();
  if (taken && taken.id !== feedId) return false;

  const { error } = await db
    .from('feeds')
    .update({
      url: to,
      // 移転先では中身が違うかもしれないので、条件付きGETの値は捨てる。
      etag: null,
      last_modified: null,
    })
    .eq('id', feedId);

  return !error;
}
