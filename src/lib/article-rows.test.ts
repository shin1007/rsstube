import { describe, expect, it } from 'vitest';
import { formatFetched, mergeRows } from '@/lib/article-rows';
import type { ArticleRow } from '@/lib/types';

const row = (id: string, state?: ArticleRow['state']): ArticleRow => ({
  id,
  title: `記事 ${id}`,
  published_at: '2026-09-05T00:00:00Z',
  excerpt: null,
  feed: null,
  summary: null,
  state: state ?? null,
});

const none = new Set<string>();

describe('mergeRows', () => {
  it('継ぎ足したぶんを1ページ目の後ろに繋ぐ', () => {
    const out = mergeRows({
      articles: [row('a'), row('b')],
      extra: [row('c')],
      patches: {},
      readMarks: none,
    });
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('両方に居る記事は1回だけ出す（未読を読むと位置がずれるため）', () => {
    const out = mergeRows({
      articles: [row('a'), row('b')],
      extra: [row('b'), row('c')],
      patches: {},
      readMarks: none,
    });
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('触っていない行は同じ参照のまま返す（Row の memo が効くように）', () => {
    const a = row('a');
    const out = mergeRows({ articles: [a], extra: [], patches: {}, readMarks: none });
    expect(out[0]).toBe(a);
  });

  it('押した操作は1ページ目にも重なる（サーバーの描き直しに頼らない）', () => {
    const out = mergeRows({
      articles: [row('a')],
      extra: [],
      patches: { a: { is_starred: true } },
      readMarks: none,
    });
    expect(out[0].state?.is_starred).toBe(true);
    expect(out[0].state?.is_read).toBe(false);
  });

  it('本文側で付いた既読（read-marks）も重なる', () => {
    const out = mergeRows({
      articles: [row('a')],
      extra: [],
      patches: {},
      readMarks: new Set(['a']),
    });
    expect(out[0].state?.is_read).toBe(true);
  });

  it('「未読に戻す」は既読の印に勝つ（押した操作を後に重ねる）', () => {
    const out = mergeRows({
      articles: [row('a', { is_read: true, is_starred: false, exported_at: null })],
      extra: [],
      patches: { a: { is_read: false } },
      readMarks: new Set(['a']),
    });
    expect(out[0].state?.is_read).toBe(false);
  });

  it('元の状態は消さない（重ねた列だけが変わる）', () => {
    const out = mergeRows({
      articles: [row('a', { is_read: false, is_starred: true, exported_at: '2026-09-01' })],
      extra: [],
      patches: { a: { read_later: true } },
      readMarks: none,
    });
    expect(out[0].state).toMatchObject({
      is_starred: true,
      exported_at: '2026-09-01',
      read_later: true,
    });
  });

  it('継ぎ足したぶんにも重なる（そちらはサーバーが描き直さない）', () => {
    const out = mergeRows({
      articles: [],
      extra: [row('c')],
      patches: { c: { is_read: true } },
      readMarks: none,
    });
    expect(out[0].state?.is_read).toBe(true);
  });
});

describe('formatFetched', () => {
  it('記事の日付と同じ日なら時刻だけを出す', () => {
    // 日本時間で 2026-09-05 15:07（＝ UTC 06:07）。
    expect(formatFetched('2026-09-05T06:07:00Z', '2026-09-05T01:00:00Z')).toBe('15:07');
  });

  it('違う日なら日付を出す', () => {
    expect(formatFetched('2026-09-05T06:07:00Z', '2026-09-01T01:00:00Z')).toBe('9/5');
  });

  it('記事の日付が無いときは日付を出す', () => {
    expect(formatFetched('2026-09-05T06:07:00Z', null)).toBe('9/5');
  });

  /**
   * **時間帯を渡さないと本番（UTC）だけずれる**（#418 の正体）。
   * TZ を変えても同じ文字になることを、ここで押さえておく。
   */
  it('動かしている機械の時間帯に左右されない', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(formatFetched('2026-09-05T06:07:00Z', '2026-09-05T01:00:00Z')).toBe('15:07');
      process.env.TZ = 'America/New_York';
      expect(formatFetched('2026-09-05T06:07:00Z', '2026-09-05T01:00:00Z')).toBe('15:07');
    } finally {
      process.env.TZ = before;
    }
  });
});
