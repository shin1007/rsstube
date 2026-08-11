export type ArticleRow = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string | null;
  excerpt: string | null;
  content_ok: boolean;
  feed: { id: string; title: string } | null;
  summary: { bullets: string[]; tags: string[]; importance: number } | null;
  state: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

export type FeedRow = {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  folder_id: string | null;
  error_count: number;
  last_error: string | null;
  last_fetched_at: string | null;
};

export type FolderRow = { id: string; name: string };

/** 一覧の表示モード。 */
export type View = 'unread' | 'starred' | 'later' | 'all';

export const VIEW_LABELS: Record<View, string> = {
  unread: '未読',
  starred: 'スター',
  later: 'あとで',
  all: 'すべて',
};
