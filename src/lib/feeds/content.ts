import { createHash } from 'node:crypto';

/**
 * 本文の同一性。
 *
 * エラーページ・同意画面・「アクセスが集中しています」の類は、どのURLで開いても
 * **同じものが返る**。長さはあるので閾値では弾けず、そのまま本文として保存され、
 * AI に渡って要約される。
 *
 * 同じフィードの中で本文が丸ごと一致したら、それは記事ではなく使い回しのページ。
 * 本物の記事どうしが完全一致することは原理的に無いので、**誤検出が起きない**。
 * フッターが同じでも本文が違えば一致しないところが、末尾の繰り返しを見る方式との違い
 * （WIRED は34件中29件が同じポッドキャスト宣伝で終わるが、あれは本文がある）。
 */

/**
 * 比べる前の整え方。
 * 空白の詰め方は 0016 / 0018 のバックフィルと揃えること。
 */
export function normalizeContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 短すぎるものは比べても意味が無いので、ハッシュを作らない。 */
export const MIN_HASH_CHARS = 100;

/**
 * 見比べる長さ。
 *
 * 全文で比べると、ナビゲーションを掴んでいる記事を取り逃がす。末尾に記事ごとの
 * 違いが少し混じるだけで一致しなくなるため。実際、東洋経済の13件は約4000字の
 * メニューを本文として持っていたのに、全文一致では1件も引っかからなかった。
 *
 * 書き出しだけを見れば、枠を掴んでいるものは毎回同じ、本物の記事は毎回違う。
 * 実データ814件で試して、引っかかったのは東洋経済の13件だけだった。
 */
const PREFIX_CHARS = 200;

export function contentHash(text: string): string | null {
  const normalized = normalizeContent(text);
  if (normalized.length < MIN_HASH_CHARS) return null;
  // 200字に満たないものは全文が対象になる（＝0016 の「丸ごと一致」と同じ判定）。
  return createHash('sha256').update(normalized.slice(0, PREFIX_CHARS), 'utf8').digest('hex');
}
