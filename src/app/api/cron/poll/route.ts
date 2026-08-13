import { fetchFeed } from '@/lib/feeds/parse';
import { urlHash } from '@/lib/feeds/url';
import { enqueueMany } from '@/lib/jobs/queue';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  const newArticleIds: string[] = [];
  // 新着記事を、それが属するフィードごとに覚えておく。あとで購読者に配る。
  const newByFeed = new Map<string, string[]>();
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
          .upsert(rows, { onConflict: 'url_hash', ignoreDuplicates: true })
          .select('id');

        if (insertError) throw insertError;
        for (const row of inserted ?? []) newArticleIds.push(row.id);
        if ((inserted ?? []).length > 0) {
          newByFeed.set(feed.id, (inserted ?? []).map((row) => row.id));
        }
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
  // 記事は共通なので、購読者が何人いても仕事は1件ずつでよい。
  if (newArticleIds.length > 0) {
    await enqueueMany(
      db,
      'extract',
      newArticleIds.map((id) => ({ article_id: id })),
    );
  }

  // 未読の状態行を、そのフィードの購読者ぶんだけ用意しておく
  // （一覧で left join せずに済ませるため）。
  const states = await fanOutStates(db, newByFeed);

  return Response.json({
    polled,
    skipped,
    failed,
    newArticles: newArticleIds.length,
    states,
  });
}

/**
 * 新着記事の未読行を、そのフィードの購読者全員に配る。
 * 戻り値は作った状態行の数。
 */
async function fanOutStates(
  db: SupabaseClient,
  newByFeed: Map<string, string[]>,
): Promise<number> {
  if (newByFeed.size === 0) return 0;

  const { data: subs, error } = await db
    .from('subscriptions')
    .select('user_id, feed_id')
    .in('feed_id', [...newByFeed.keys()]);
  if (error) throw error;

  const rows: { article_id: string; user_id: string }[] = [];
  for (const sub of subs ?? []) {
    for (const articleId of newByFeed.get(sub.feed_id) ?? []) {
      rows.push({ article_id: articleId, user_id: sub.user_id });
    }
  }
  if (rows.length === 0) return 0;

  const { error: upsertError } = await db
    .from('article_states')
    .upsert(rows, { onConflict: 'article_id,user_id', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  return rows.length;
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;
