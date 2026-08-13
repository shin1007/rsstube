/**
 * PostgREST の or フィルタに入れる検索語の下ごしらえ。
 *
 * `or=(title.ilike.%X%,content_text.ilike.%X%)` という文字列を組み立てる都合上、
 * X にカンマや括弧が入ると式そのものが壊れる（400 が返る）。日本語だと
 * 「〜、〜」「（〜）」は普通に打たれるので、素通しにはできない。
 *
 * 記号で厳密に絞りたい場面は無いので、壊す文字は空白に落として捨てる。
 * % と _ は ilike のワイルドカードなので、これも落として文字通りに扱う。
 */
export function sanitizeSearch(input: string): string {
  return input
    .replace(/[,()"\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
