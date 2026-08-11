import { fetchFeed } from '@/lib/feeds/parse';
import { urlHash } from '@/lib/feeds/url';
import { enqueueMany } from '@/lib/jobs/queue';
import { authorizeCron, createAdminClient, ownerUserId } from '@/lib/supabase/admin';

/**
 * フィード巡回。pg_cron から1時間毎に叩かれる（supabase/scheduler.sql）。
 *
 * Vercel Hobby の cron は1日1回までなので、定期実行は Supabase 側に持たせている。
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
  const userId = ownerUserId();

  // 最後に取得してから古い順。連続失敗しているフィードは間隔を空ける
  // （error_count 時間ぶん待つ。10回失敗すれば10時間に1回まで落ちる）。
  const { data: feeds, error } = await db
    .from('feeds')
    .select('id, url, etag, last_modified, last_fetched_at, error_count')
    .eq('user_id', userId)
    .order('last_fetched_at', { ascending: true, nullsFirst: true })
    .limit(FEEDS_PER_RUN);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const newArticleIds: string[] = [];
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

      const rows = result.items.map((item) => ({
        user_id: userId,
        feed_id: feed.id,
        guid: item.guid ?? null,
        url: item.url,
        url_hash: urlHash(item.url),
        title: item.title,
        author: item.author ?? null,
        published_at: item.publishedAt ?? null,
        excerpt: item.excerpt ?? null,
        // 本文は後段の extract ジョブが上書きする。それまでは RSS の内容を出しておく。
        content_text: item.contentHtml ?? item.excerpt ?? null,
        content_ok: false,
      }));

      if (rows.length > 0) {
        // 既出の記事は url_hash の一意制約で弾く。ignoreDuplicates で
        // 「既読にした記事が再取得で未読に戻る」事故を防ぐ。
        const { data: inserted, error: insertError } = await db
          .from('articles')
          .upsert(rows, { onConflict: 'user_id,url_hash', ignoreDuplicates: true })
          .select('id');

        if (insertError) throw insertError;
        for (const row of inserted ?? []) newArticleIds.push(row.id);
      }

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

  // 新着記事ぶんの本文抽出をキューへ。要約は抽出が終わってから積む。
  if (newArticleIds.length > 0) {
    await enqueueMany(
      db,
      userId,
      'extract',
      newArticleIds.map((id) => ({ article_id: id })),
    );
  }

  // 未読の状態行を用意しておく（一覧で left join せずに済ませるため）。
  if (newArticleIds.length > 0) {
    await db
      .from('article_states')
      .upsert(
        newArticleIds.map((id) => ({ article_id: id, user_id: userId })),
        { onConflict: 'article_id', ignoreDuplicates: true },
      );
  }

  return Response.json({ polled, skipped, failed, newArticles: newArticleIds.length });
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;
