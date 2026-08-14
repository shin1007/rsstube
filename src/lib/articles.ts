import { createClient } from '@/lib/supabase/server';
import { sanitizeSearch } from '@/lib/search';
import type { ArticleRow, View } from '@/lib/types';

/**
 * 一覧用の記事取得。
 *
 * 記事・要約・状態を1クエリで取る。Supabase の埋め込み選択を使うので
 * N+1 にはならない。並び順は「新着順」か「重要度順」。
 *
 * 記事とフィードは全ユーザー共通なので（0005）、「自分の記事」を切り出しているのは
 * article_states!inner のほう。状態行は購読時と巡回時にしか作られないため、
 * これが購読フィルタを兼ねる。フォルダは購読ごとの持ち物なので subscriptions を見る。
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
  extracted_at: string | null;
  feeds: { id: string; title: string; subscriptions?: unknown } | null;
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
      `id, title, url, author, published_at, excerpt, content_ok, extracted_at,
       feeds!inner (id, title, subscriptions!inner (folder_id)),
       summaries (bullets, tags, importance),
       article_states!inner (is_read, is_starred, read_later, exported_at)`,
    )
    .limit(PAGE_SIZE);

  if (query.feedId) q = q.eq('feed_id', query.feedId);
  if (query.folderId) q = q.eq('feeds.subscriptions.folder_id', query.folderId);

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
      //
      // ただし「まだ本文を取りに行っていない記事」は、要約が無くて当たり前で、
      // 待てば付く。混ぜると順番待ちの山に埋もれて、本当に落ちたものが見えなくなる
      // （実際に95件の順番待ちがあった）。処理済みのものだけを出す（0014）。
      q = q.is('summaries', null).not('extracted_at', 'is', null);
      break;
    case 'all':
      break;
  }

  if (query.search) {
    // 日本語は形態素解析が無いので、タイトルと本文の部分一致で引く。
    // 検索語をそのまま埋めるとカンマや括弧で or 式が壊れるので落としておく。
    const term = sanitizeSearch(query.search);
    if (term) q = q.or(`title.ilike.%${term}%,content_text.ilike.%${term}%`);
  }

  if (query.sort === 'important') {
    // articles.importance は summaries.importance の複製（0007）。
    // 埋め込んだ summaries 側を order しても親の記事順は変わらないので、
    // 並べ替えは必ず articles 側の列で行うこと。
    // 要約がまだ無い記事は null になり、末尾に回る。
    q = q
      .order('importance', { ascending: false, nullsFirst: false })
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
    extracted_at: r.extracted_at,
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
      `id, title, url, author, published_at, excerpt, content_text, content_ok, extracted_at,
       feeds (id, title),
       summaries (bullets, tags, importance),
       article_states (is_read, is_starred, read_later, exported_at)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** サイドバーに出す未読件数。フィード単位で集計する（呼び出し側でフォルダにまとめる）。 */
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
