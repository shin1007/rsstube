import { createClient } from '@/lib/supabase/server';
import { sanitizeSearch } from '@/lib/search';
import type { ArticleRow } from '@/lib/types';

/**
 * アーカイブ検索（/library）。
 *
 * リーダーの一覧が「これから読むもの」を捌く場所なのに対して、こちらは
 * 「前に読んだあれ」を掘り返す場所。既読も込みで全部を対象にする。
 *
 * 検索の効き方について:
 *   タイトルは trgm 索引（0001 の articles_title_trgm_idx）が効くので速い。
 *   本文は索引を張っていないので順スキャンになる。8KB×記事数を舐めることになり、
 *   記事が増えると重い。なので本文検索は既定では行わず、チェックを入れたときだけ。
 *   本文に trgm 索引を張れば速くなるが、索引だけで数百MBになり得るので
 *   Supabase の無料枠（500MB）とは釣り合わない。本文は90日で消える前提でもある。
 *
 *   simple 辞書の tsvector（articles_fts_idx）は日本語だと語境界を取れず
 *   実質使えないため、ここでは使っていない。
 */

export const LIBRARY_PAGE_SIZE = 40;

export type LibraryQuery = {
  q?: string;
  /** 本文も対象にする。既定はタイトルのみ。 */
  deep?: boolean;
  tag?: string;
  starred?: boolean;
  exported?: boolean;
  /** 何日前まで遡るか。未指定は全期間。 */
  days?: number;
  page?: number;
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
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; importance: number; title_ja: string | null } | null;
  article_states: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

export async function searchLibrary(
  query: LibraryQuery,
): Promise<{ rows: ArticleRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const page = Math.max(0, query.page ?? 0);
  const from = page * LIBRARY_PAGE_SIZE;

  // タグで絞るときだけ summaries を内部結合にする。そうしないと
  // 要約がまだ無い記事まで残ってしまう。
  const summaryJoin = query.tag ? 'summaries!inner' : 'summaries';

  let q = supabase
    .from('articles')
    .select(
      `id, title, url, author, published_at, excerpt, content_ok, extracted_at,
       feeds!inner (id, title),
       ${summaryJoin} (bullets, tags, importance, title_ja),
       article_states!inner (is_read, is_starred, read_later, exported_at)`,
    )
    // 状態行があるもの＝自分が購読しているフィードの記事（0005 以降の切り出し方）。
    // もう1件多く取って「次のページがあるか」を判定する。
    .range(from, from + LIBRARY_PAGE_SIZE);

  const term = query.q ? sanitizeSearch(query.q) : '';
  if (term) {
    // **訳した見出しも見ること。** 一覧に出しているのは title_ja のほうなので、
    // 原題だけを引くと「画面に見えている語で検索しても当たらない」ことになる
    // （英語のフィードは記事の42%）。埋め込んだ summaries の列では親を絞れないため、
    // articles 側の複製を引く（0024）。
    q = query.deep
      ? q.or(`title.ilike.%${term}%,title_ja.ilike.%${term}%,content_text.ilike.%${term}%`)
      : q.or(`title.ilike.%${term}%,title_ja.ilike.%${term}%`);
  }

  if (query.tag) q = q.contains('summaries.tags', [query.tag]);
  if (query.starred) q = q.eq('article_states.is_starred', true);
  if (query.exported) q = q.not('article_states.exported_at', 'is', null);

  if (query.days && query.days > 0) {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte('published_at', since);
  }

  q = q.order('published_at', { ascending: false, nullsFirst: false });

  const { data, error } = await q;
  if (error) throw error;

  const raw = (data ?? []) as unknown as RawRow[];
  const hasMore = raw.length > LIBRARY_PAGE_SIZE;

  return {
    rows: raw.slice(0, LIBRARY_PAGE_SIZE).map((r) => ({
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
    })),
    hasMore,
  };
}

/**
 * 絞り込みに出すタグの一覧。
 *
 * 直近の要約から拾って多い順に並べる。タグは要約のたびに Gemini が付けるので
 * 語彙が発散しやすく、全期間から集めると使わないタグで埋まる。
 */
export async function listTags(limit = 24): Promise<{ tag: string; count: number }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('articles')
    .select('summaries!inner (tags), article_states!inner (is_read)')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { summaries: { tags: string[] } | null }[]) {
    for (const tag of row.summaries?.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
