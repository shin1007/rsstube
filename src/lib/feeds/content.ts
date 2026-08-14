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
 * 空白の詰め方は 0016 のバックフィルと揃えること（片方だけ変えると既存ぶんと衝突しない）。
 */
export function normalizeContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 短すぎるものは比べても意味が無いので、ハッシュを作らない。 */
export const MIN_HASH_CHARS = 100;

export function contentHash(text: string): string | null {
  const normalized = normalizeContent(text);
  if (normalized.length < MIN_HASH_CHARS) return null;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
