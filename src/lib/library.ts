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
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; title_ja: string | null } | null;
  article_states: { is_starred: boolean; exported_at: string | null } | null;
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
    /**
     * **行に出していない列は取らない**（reader の一覧と同じ。perf.md）。
     * `content_ok` `extracted_at` `created_at` `is_read` `read_later` は
     * `/library` のどこにも出ないのに、40件ぶん毎回運んでいた。
     */
    .select(
      `id, title, url, author, published_at, excerpt,
       feeds!inner (id, title),
       ${summaryJoin} (bullets, tags, title_ja),
       article_states!inner (is_starred, exported_at)`,
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

  // 同着は id で決める。ここも offset でページを繰るので、決めないと
  // ページの境目で記事が重複・欠落する（lib/articles.ts の run を参照）。
  q = q.order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false });

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
      /**
       * **要点があるときは抜粋を運ばない。** 行に出るのはどちらか片方で、
       * 要点があればそちらが勝つ。抜粋は日本語で150字ほどあり、
       * 1行あたりでいちばん重い列なのに、ほとんどの行では出ない
       * （reader の一覧と同じ。lib/articles.ts の listArticles）。
       */
      excerpt: (r.summaries?.bullets?.length ?? 0) > 0 ? null : r.excerpt,
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
 *
 * **数えるのは DB 側**（0038 の `recent_tags()`）。
 *
 * 以前は直近500件の `summaries.tags` を**アプリまで運んで**（実測 42KB・
 * サーバー側75ms）JS で数えていた。欲しいのは24語とその件数だけなので、
 * 出す量の百倍以上を毎回 `/library` の遷移に乗せていたことになる
 * （0020 で未読件数を SQL に移したのと同じ形の無駄）。
 */
export async function listTags(limit = 24): Promise<{ tag: string; count: number }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('recent_tags', { p_scan: 500, p_limit: limit });
  if (error) throw error;

  return ((data ?? []) as { tag: string; uses: number }[]).map((r) => ({
    tag: r.tag,
    count: Number(r.uses),
  }));
}
