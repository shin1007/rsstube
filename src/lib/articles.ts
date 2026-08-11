import { createClient } from '@/lib/supabase/server';
import type { ArticleRow, View } from '@/lib/types';

/**
 * 一覧用の記事取得。
 *
 * 記事・要約・状態を1クエリで取る。Supabase の埋め込み選択を使うので
 * N+1 にはならない。並び順は「新着順」か「重要度順」。
 */

export const PAGE_SIZE = 60;

export type ArticleQuery = {
  view: View;
  folderId?: string;
  feedId?: string;
  sort: 'new' | 'important';
  search?: string;
};

type RawRow = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string | null;
  excerpt: string | null;
  content_ok: boolean;
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; importance: number } | null;
  article_states: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

export async function listArticles(query: ArticleQuery): Promise<ArticleRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from('articles')
    .select(
      `id, title, url, author, published_at, excerpt, content_ok,
       feeds!inner (id, title, folder_id),
       summaries (bullets, tags, importance),
       article_states!inner (is_read, is_starred, read_later, exported_at)`,
    )
    .limit(PAGE_SIZE);

  if (query.feedId) q = q.eq('feed_id', query.feedId);
  if (query.folderId) q = q.eq('feeds.folder_id', query.folderId);

  switch (query.view) {
    case 'unread':
      q = q.eq('article_states.is_read', false);
      break;
    case 'starred':
      q = q.eq('article_states.is_starred', true);
      break;
    case 'later':
      q = q.eq('article_states.read_later', true);
      break;
    case 'unsummarized':
      // ワーカーは要約が返らなかった記事もジョブを完了扱いにする（無料枠を
      // 食い潰さないため）。落ちたぶんはここでしか見つけられない。
      q = q.is('summaries', null);
      break;
    case 'all':
      break;
  }

  if (query.search) {
    // 日本語は形態素解析が無いので、タイトルと本文の部分一致で引く。
    q = q.or(`title.ilike.%${query.search}%,content_text.ilike.%${query.search}%`);
  }

  if (query.sort === 'important') {
    // 要約がまだ無い記事は importance が null になり、末尾に回る。
    q = q
      .order('importance', { referencedTable: 'summaries', ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('published_at', { ascending: false, nullsFirst: false });
  }

  const { data, error } = await q;
  if (error) throw error;

  return ((data ?? []) as unknown as RawRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    author: r.author,
    published_at: r.published_at,
    excerpt: r.excerpt,
    content_ok: r.content_ok,
    feed: r.feeds ? { id: r.feeds.id, title: r.feeds.title } : null,
    summary: r.summaries ?? null,
    state: r.article_states ?? null,
  }));
}

export async function getArticle(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select(
      `id, title, url, author, published_at, excerpt, content_text, content_ok,
       feeds (id, title),
       summaries (bullets, tags, importance),
       article_states (is_read, is_starred, read_later, exported_at)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** サイドバーに出す未読件数。フォルダ単位で集計する。 */
export async function unreadCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('feed_id, article_states!inner (is_read)')
    .eq('article_states.is_read', false)
    .limit(5000);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { feed_id: string }[]) {
    counts.set(row.feed_id, (counts.get(row.feed_id) ?? 0) + 1);
  }
  return counts;
}
