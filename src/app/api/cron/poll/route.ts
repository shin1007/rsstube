import { fetchFeed } from '@/lib/feeds/parse';
import { ingestFeedItems } from '@/lib/feeds/ingest';
import { authorizeCron, createAdminClient } from '@/lib/supabase/admin';

/**
 * フィード巡回。pg_cron から1時間毎に叩かれる（supabase/scheduler.sql）。
 *
 * Vercel Hobby の cron は1日1回までなので、定期実行は Supabase 側に持たせている。
 *
 * フィードと記事は全ユーザー共通なので、巡回は1回で全員ぶんを兼ねる（0005）。
 * ユーザーごとに違うのは「誰がそのフィードを購読しているか」だけで、それは
 * 新着記事の未読行を作るところにだけ効く。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 1回の実行で巡回するフィード数。サーバーレス関数の実行時間に収まる程度に抑える。 */
const FEEDS_PER_RUN = 40;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createAdminClient();

  // 最後に取得してから古い順。連続失敗しているフィードは間隔を空ける
  // （error_count 時間ぶん待つ。10回失敗すれば10時間に1回まで落ちる）。
  const { data: feeds, error } = await db
    .from('feeds')
    .select('id, url, etag, last_modified, last_fetched_at, error_count')
    .order('last_fetched_at', { ascending: true, nullsFirst: true })
    .limit(FEEDS_PER_RUN);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  let newArticles = 0;
  let states = 0;
  let polled = 0;
  let skipped = 0;
  let failed = 0;

  for (const feed of feeds ?? []) {
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
      await db
        .from('feeds')
        .update({
          last_fetched_at: new Date().toISOString(),
          error_count: feed.error_count + 1,
          last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        })
        .eq('id', feed.id);
    }
  }

  return Response.json({ polled, skipped, failed, newArticles, states });
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;
