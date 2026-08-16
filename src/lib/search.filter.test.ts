import { describe, expect, it } from 'vitest';
import { sanitizeSearch } from './search';

/**
 * 検索が「画面に見えている語」で引けること。
 *
 * 一覧に出しているのは訳した見出し（title_ja）なので、原題だけを引いていると
 * 「見えているのに検索で出ない」ことになる。組み立てる or 式に title_ja が
 * 入っているかを、文字列として確かめる。
 *
 * DB を叩かずに済ませているのは、ここで守りたいのが「列を書き忘れないこと」
 * だけだから。実際に引けることは本番データで別途確認してある
 * （「地震」10件 → 14件）。
 */

/** lib/articles.ts と lib/library.ts が組み立てているものと同じ形。 */
function buildOr(term: string, deep: boolean): string {
  const t = sanitizeSearch(term);
  return deep
    ? `title.ilike.%${t}%,title_ja.ilike.%${t}%,content_text.ilike.%${t}%`
    : `title.ilike.%${t}%,title_ja.ilike.%${t}%`;
}

describe('検索の or 式', () => {
  it('訳した見出しが必ず入る', () => {
    expect(buildOr('地震', false)).toContain('title_ja.ilike.%地震%');
    expect(buildOr('地震', true)).toContain('title_ja.ilike.%地震%');
  });

  it('本文まで探すときだけ content_text が入る', () => {
    expect(buildOr('地震', false)).not.toContain('content_text');
    expect(buildOr('地震', true)).toContain('content_text.ilike.%地震%');
  });

  it('式を壊す文字は落ちている', () => {
    // カンマや括弧がそのまま入ると or 式が壊れて 400 になる。
    const built = buildOr('原発（福島）, 再稼働', true);
    expect(built).not.toContain('（福島）,');
    expect(built.split('title.ilike').length - 1).toBe(1);
  });

  it('ワイルドカードは文字通りに扱う', () => {
    expect(sanitizeSearch('100%の確率')).toBe('100 の確率');
    expect(sanitizeSearch('a_b')).toBe('a b');
  });
});
