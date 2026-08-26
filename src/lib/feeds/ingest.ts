import { stripRepeatedTails } from '@/lib/feeds/title';
import { urlHash } from '@/lib/feeds/url';
import { enqueueMany } from '@/lib/jobs/queue';
import type { FetchFeedResult } from '@/lib/feeds/parse';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 取得したフィードの中身を記事として入れる。
 *
 * 巡回（/api/cron/poll）と、フィードを登録した直後の初回取り込みの両方から呼ぶ。
 * 同じ入れ方でないと困る（登録直後だけ本文抽出が積まれない、といった差が出る）。
 *
 * 記事・フィードは全ユーザー共通なので（0005）、書き込みは Secret キーの
 * クライアントで行う。購読者ごとに違うのは未読の状態行だけ。
 */

export type IngestResult = {
  newArticles: number;
  /** 作った未読の状態行の数。 */
  states: number;
};

export async function ingestFeedItems(
  db: SupabaseClient,
  feedId: string,
  result: Extract<FetchFeedResult, { status: 'ok' }>,
): Promise<IngestResult> {
  if (result.items.length === 0) return { newArticles: 0, states: 0 };

  // サイト名・連載名がタイトルに混ざっているフィードがある
  // （東洋経済は75件中75件が「| 政治・経済・投資 | 東洋経済オンライン」付き）。
  // 一覧でも要約でも音声でも毎回同じ十数文字が付いて回るので、ここで落とす。
  // 判断は1回の取得ぶんの中だけで完結する（lib/feeds/title.ts）。
  const titles = stripRepeatedTails(result.items.map((i) => i.title));

  const rows = result.items.map((item, i) => ({
    feed_id: feedId,
    guid: item.guid ?? null,
    url: item.url,
    url_hash: urlHash(item.url),
    // 落としたあとの見出し。原題ではなくこちらを保存する（一覧・要約・音声の全部に効く）。
    title: titles[i],
    author: item.author ?? null,
    published_at: item.publishedAt ?? null,
    excerpt: item.excerpt ?? null,
    // 本文は後段の extract ジョブが上書きする。それまでは RSS の内容を出しておく。
    content_text: item.contentHtml ?? item.excerpt ?? null,
    // **上書きされない控え（0021）。** content_text は抽出結果に置き換わるので、
    // 「失敗したら RSS に戻す」ための元をここに残す。これが無いと、取り直しの
    // たびに前回掴んだゴミを読み直すことになる。
    rss_html: item.contentHtml ?? null,
    // フィードに絵が付いていればここで控える。og:image が取れれば
    // 抽出のときに上書きされる（あちらのほうが記事の代表として当たりが良い）。
    image_url: item.imageUrl ?? null,
    content_ok: false,
  }));

  // 既出の記事は url_hash の一意制約で弾く。ignoreDuplicates で
  // 「既読にした記事が再取得で未読に戻る」事故を防ぐ。
  const { data: inserted, error } = await db
    .from('articles')
    .upsert(rows, { onConflict: 'url_hash', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;

  /**
   * 日付が空いている既存記事を埋め直す（`0030`）。
   *
   * 上の upsert は `ignoreDuplicates` なので、**既に入っている記事には何も起きない**。
   * `JST` を読めるようにしても（lib/feeds/date.ts）、それ以前に日付なしで入った
   * ぶんは末尾に沈んだまま直らない。取り込みのたびに、いま手元にある項目ぶんだけ
   * 埋め戻す。新しい略号に対応したときも、次の巡回で勝手に追いつく。
   *
   * **新着が無くても通す。** 直す対象は既存行なので、ids が空でも意味がある。
   */
  const dated = result.items
    .filter((i) => i.publishedAt)
    .map((i) => ({ h: urlHash(i.url), d: i.publishedAt as string }));
  if (dated.length > 0) {
    const { error: backfillError } = await db.rpc('backfill_published_at', { pairs: dated });
    // 埋め戻しに失敗しても取り込み自体は続ける。日付が欠けるだけで記事は読める。
    if (backfillError) console.error('backfill_published_at failed', backfillError);
  }

  const ids = (inserted ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { newArticles: 0, states: 0 };

  // 新着が入った時刻を控える。取得は成功しているのに更新が止まったフィードは、
  // これが無いと見分けられない（失敗回数は 0 のままなので）。
  // ここが黙って失敗すると、更新が止まったフィードを見つける手立てが消える
  // （失敗回数は 0 のままなので、一覧を眺めても分からない型の死に方）。
  const { error: stampError } = await db
    .from('feeds')
    .update({ last_article_at: new Date().toISOString() })
    .eq('id', feedId);
  if (stampError) throw stampError;

  // 本文抽出をキューへ。要約は抽出が終わってから積まれる。
  await enqueueMany(db, 'extract', ids.map((id) => ({ article_id: id })));

  const states = await fanOutStates(db, feedId, ids);
  return { newArticles: ids.length, states };
}

/**
 * 新着記事の未読行を、そのフィードの購読者全員に配る。
 * 一覧で left join せずに済ませるため、状態行は先に作っておく。
 */
export async function fanOutStates(
  db: SupabaseClient,
  feedId: string,
  articleIds: string[],
): Promise<number> {
  if (articleIds.length === 0) return 0;

  const { data: subs, error } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('feed_id', feedId);
  if (error) throw error;

  const rows = (subs ?? []).flatMap((sub) =>
    articleIds.map((articleId) => ({ article_id: articleId, user_id: sub.user_id as string })),
  );
  if (rows.length === 0) return 0;

  const { error: upsertError } = await db
    .from('article_states')
    .upsert(rows, { onConflict: 'article_id,user_id', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  return rows.length;
}
