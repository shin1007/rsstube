import { createClient } from '@/lib/supabase/server';
import { sanitizeSearch } from '@/lib/search';
import type { ArticleRow } from '@/lib/types';

/**
 * アーカイブ検索（/library）。
 *
 * リーダーの一覧が「これから読むもの」を捌く場所なのに対して、こちらは
 * 「前に読んだあれ」を掘り返す場所。既読も込みで全部を対象にする。
 * 購読をやめたフィードの記事も、読んだことがあるなら出る（切り出しているのは
 * `article_states` の有無だけ）。
 *
 * **問い合わせは `search_library()`（0042）に1本化してある。**
 *
 * 検索は PGroonga の `&@`（0015 の索引）。以前は `ilike` で、しかも
 * 「本文も探す」を押したときだけ本番のデータで **53〜131ms** かかっていた
 * ——索引は使われていても、そのあと候補の本文を取り出して `ilike` を
 * やり直していたため（一覧の検索は 0040 で移してあり、ここだけ残っていた）。
 * 実測（素の往復 34.9ms を引いたぶん）:
 *
 *   語     見出しだけ ilike   本文も＝deep の ilike   いま（&@）
 *   AI       5.9ms /  36件      131.0ms / 41件        5.2ms /  94件
 *   健康     2.4ms /   4件       57.8ms / 41件        2.1ms / 129件
 *   医療     1.9ms /  34件       52.9ms / 41件        2.5ms / 138件
 *
 * **当たりは増える。** `&@` は語として照合するので、`ilike '%AI%'` のように
 * 「Said」「Training」まで拾うことが無い代わりに、全角と半角・大小文字を
 * 正規化して同じ語として当てる。
 *
 * 当たった id をアプリまで運んで当て直す形（0040 の `search_article_ids()`）に
 * しなかったのは、`in.(…)` で URL に並べられるのが実測300件（約11KB）までで、
 * **古いほうから切り落とすことになる**ため。ここは古いものを探しに来る場所。
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

export async function searchLibrary(
  query: LibraryQuery,
): Promise<{ rows: ArticleRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const page = Math.max(0, query.page ?? 0);

  const term = query.q ? sanitizeSearch(query.q) : '';
  // 消毒して何も残らなかった語は「絞らない」ではなく「1件も当たらない」。
  if (query.q && !term) return { rows: [], hasMore: false };

  const { data, error } = await supabase.rpc('search_library', {
    p_term: term || null,
    p_deep: !!query.deep,
    p_tag: query.tag ?? null,
    p_starred: !!query.starred,
    p_exported: !!query.exported,
    p_days: query.days && query.days > 0 ? query.days : null,
    // もう1件多く頼んで「次のページがあるか」を見る。
    p_limit: LIBRARY_PAGE_SIZE + 1,
    p_offset: page * LIBRARY_PAGE_SIZE,
  });

  if (error) throw error;

  // 行の形は ArticleRow に合わせて SQL 側で組んである（抜粋を落とすかどうかも
  // 向こうで決まる）。ここで詰め替えるものは無い。
  const rows = (data ?? []) as ArticleRow[];

  return { rows: rows.slice(0, LIBRARY_PAGE_SIZE), hasMore: rows.length > LIBRARY_PAGE_SIZE };
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
