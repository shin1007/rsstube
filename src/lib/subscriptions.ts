import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * 購読している feed_id とフォルダだけ。**一覧の絞り込み用。**
 *
 * 以前は記事の一覧を引くたびに `feeds!inner (subscriptions!inner (folder_id))` と
 * 入れ子で埋め込んで、購読しているフィードだけに絞っていた。正しいのだが
 * **その入れ子ひとつで未読一覧が7倍遅かった**（本番相当の実測で 227ms → 31ms）。
 * 購読は12本しかないので、id を先に引いて `feed_id in (…)` で絞るほうが速い。
 *
 * `cache()` は1リクエストの中で結果を使い回す（React の per-request キャッシュ）。
 * 一覧・件数・前後の id の3つが同じ絞り込みを使うので、問い合わせは1回で済む。
 * リクエストをまたいでは残らないので、購読を変えた直後から効く。
 */
export const subscribedFeedIds = cache(async (): Promise<
  { feed_id: string; folder_id: string | null }[]
> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('subscriptions').select('feed_id, folder_id');
  if (error) throw error;
  return data ?? [];
});

/**
 * 購読しているフィードの一覧。
 *
 * feeds は全ユーザー共通で、RLS もログイン済みなら全行読める（0005）。
 * つまり feeds を直に select すると他人が購読しているフィードまで出てくる。
 * 「自分のフィード」は必ず subscriptions 側から引くこと。
 *
 * フォルダと表示名は購読ごとの持ち物なので、購読側の値をフィード側より優先する。
 */

export type SubscribedFeed = {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  folder_id: string | null;
  error_count: number;
  last_error: string | null;
  last_fetched_at: string | null;
  /** 最後に新しい記事が入った時刻（0013）。更新が止まったフィードを見つけるため。 */
  last_article_at: string | null;
  created_at: string | null;
  /** 直近60日で本文を取りに行った件数（0028）。健康診断で使う。 */
  extracted: number;
  /** そのうち本文を取れなかった件数。 */
  unreadable: number;
  /** 直近60日に取り込んだ件数（0030）。日付なしの母数。 */
  ingested: number;
  /** そのうち日付が入っていない件数。 */
  undated: number;
};

type Row = {
  folder_id: string | null;
  title: string | null;
  feeds: {
    id: string;
    title: string;
    url: string;
    site_url: string | null;
    error_count: number;
    last_error: string | null;
    last_fetched_at: string | null;
    last_article_at: string | null;
    created_at: string | null;
  } | null;
};

export async function listSubscribedFeeds(): Promise<SubscribedFeed[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      `folder_id, title,
       feeds!inner (id, title, url, site_url, error_count, last_error, last_fetched_at, last_article_at, created_at)`,
    );
  if (error) throw error;

  /**
   * 本文の取れ具合はフィードの列ではないので、別に数えて足す。
   *
   * **記事を運んできて JS で数えない**（0020 で未読件数を SQL に移したのと同じ）。
   * 欲しいのはフィード18本ぶんの数字2つで、記事は4600件ある。
   */
  const { data: stats } = await supabase.rpc('feed_content_stats');
  const byFeed = new Map(
    ((stats ?? []) as { feed_id: string; ingested: number; extracted: number; unreadable: number; undated: number }[]).map((s) => [
      s.feed_id,
      s,
    ]),
  );

  return ((data ?? []) as unknown as Row[])
    .filter((r): r is Row & { feeds: NonNullable<Row['feeds']> } => r.feeds !== null)
    .map((r) => ({
      id: r.feeds.id,
      title: r.title || r.feeds.title,
      url: r.feeds.url,
      site_url: r.feeds.site_url,
      folder_id: r.folder_id,
      error_count: r.feeds.error_count,
      last_error: r.feeds.last_error,
      last_fetched_at: r.feeds.last_fetched_at,
      last_article_at: r.feeds.last_article_at,
      created_at: r.feeds.created_at,
      extracted: Number(byFeed.get(r.feeds.id)?.extracted ?? 0),
      unreadable: Number(byFeed.get(r.feeds.id)?.unreadable ?? 0),
      ingested: Number(byFeed.get(r.feeds.id)?.ingested ?? 0),
      undated: Number(byFeed.get(r.feeds.id)?.undated ?? 0),
    }))
    // 並べ替えは件数が少ないのでこちらで。埋め込み先の列では order できない。
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
