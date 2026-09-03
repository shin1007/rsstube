import { describe, expect, it } from 'vitest';
import { pickDigestArticles, type DigestCandidate } from './select';

const a = (
  id: string,
  publishedAt: string | null = null,
  folderId: string | null = null,
  createdAt: string | null = null,
): DigestCandidate => ({ id, publishedAt, folderId, createdAt });

describe('pickDigestArticles', () => {
  it('新しい順に選ぶ', () => {
    const picked = pickDigestArticles(
      [a('old', '2026-08-01T00:00:00Z'), a('new', '2026-08-30T00:00:00Z'), a('mid', '2026-08-15T00:00:00Z')],
      2,
    );
    expect(picked.map((c) => c.id)).toEqual(['new', 'mid']);
  });

  it('1つのフォルダで全体の1/3を超えて埋めない', () => {
    // 更新の速いフォルダが上位を独占していても、他のフォルダにも枠が回る。
    const candidates = [
      a('t1', '2026-08-30T09:00:00Z', 'tech'),
      a('t2', '2026-08-30T08:00:00Z', 'tech'),
      a('t3', '2026-08-30T07:00:00Z', 'tech'),
      a('t4', '2026-08-30T06:00:00Z', 'tech'),
      a('n1', '2026-08-30T05:00:00Z', 'news'),
      a('n2', '2026-08-30T04:00:00Z', 'news'),
    ];
    const picked = pickDigestArticles(candidates, 6);
    // 上限は ceil(6/3) = 2 件。3件目以降は他が尽きてから入る。
    expect(picked.filter((c) => c.folderId === 'tech').slice(0, 2).map((c) => c.id)).toEqual(['t1', 't2']);
    expect(picked.map((c) => c.id).sort()).toEqual(['n1', 'n2', 't1', 't2', 't3', 't4']);
  });

  it('他に選べるものが無ければ上限を超えて埋める', () => {
    const candidates = [
      a('t1', '2026-08-30T09:00:00Z', 'tech'),
      a('t2', '2026-08-30T08:00:00Z', 'tech'),
      a('t3', '2026-08-30T07:00:00Z', 'tech'),
    ];
    expect(pickDigestArticles(candidates, 3).map((c) => c.id)).toEqual(['t1', 't2', 't3']);
  });

  it('候補が枠より少なければあるだけ返す', () => {
    expect(pickDigestArticles([a('x', '2026-08-30T00:00:00Z')], 8)).toHaveLength(1);
  });

  it('published_at が無ければ取り込んだ時刻で並べる', () => {
    const picked = pickDigestArticles(
      [a('none', null, null, '2026-08-30T00:00:00Z'), a('old', '2026-08-01T00:00:00Z')],
      1,
    );
    expect(picked.map((c) => c.id)).toEqual(['none']);
  });

  it('どちらの時刻も無い記事は最後尾に回る', () => {
    const picked = pickDigestArticles([a('blank'), a('dated', '2026-08-01T00:00:00Z')], 1);
    expect(picked.map((c) => c.id)).toEqual(['dated']);
  });

  it('同時刻でも並びが決まる（作り直しても同じものが選ばれる）', () => {
    // 省庁や自治体は同じ時刻でまとめて出す。決着を付けないと実行計画次第で変わる。
    const same = '2026-08-30T00:00:00Z';
    const first = pickDigestArticles([a('b', same), a('c', same), a('a', same)], 2);
    const again = pickDigestArticles([a('c', same), a('a', same), a('b', same)], 2);
    expect(first.map((c) => c.id)).toEqual(again.map((c) => c.id));
  });

  it('件数が0なら何も選ばない', () => {
    expect(pickDigestArticles([a('x', '2026-08-30T00:00:00Z')], 0)).toEqual([]);
  });
});
