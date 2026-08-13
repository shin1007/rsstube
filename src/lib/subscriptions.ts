import { createClient } from '@/lib/supabase/server';

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
  } | null;
};

export async function listSubscribedFeeds(): Promise<SubscribedFeed[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      `folder_id, title,
       feeds!inner (id, title, url, site_url, error_count, last_error, last_fetched_at)`,
    );
  if (error) throw error;

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
    }))
    // 並べ替えは件数が少ないのでこちらで。埋め込み先の列では order できない。
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
