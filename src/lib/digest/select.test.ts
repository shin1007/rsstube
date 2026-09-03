import { describe, expect, it } from 'vitest';
import { effectiveScore, pickDigestArticles, type DigestCandidate } from './select';

const a = (
  id: string,
  importance: number | null,
  folderId: string | null = null,
  publishedAt: string | null = null,
  weight: number | null = null,
): DigestCandidate => ({ id, importance, folderId, publishedAt, weight });

describe('pickDigestArticles', () => {
  it('重要度の高い順に選ぶ', () => {
    const picked = pickDigestArticles([a('low', 10), a('high', 90), a('mid', 50)], 2);
    expect(picked.map((c) => c.id)).toEqual(['high', 'mid']);
  });

  it('1つのフォルダで全体の1/3を超えて埋めない', () => {
    // 技術フォルダが上位を独占していても、他のフォルダにも枠が回る。
    const candidates = [
      a('t1', 99, 'tech'),
      a('t2', 98, 'tech'),
      a('t3', 97, 'tech'),
      a('t4', 96, 'tech'),
      a('n1', 40, 'news'),
      a('n2', 39, 'news'),
    ];
    const picked = pickDigestArticles(candidates, 6);
    const tech = picked.filter((c) => c.folderId === 'tech');
    // 上限は ceil(6/3) = 2 件。3件目以降は他が尽きてから入る。
    expect(tech.slice(0, 2).map((c) => c.id)).toEqual(['t1', 't2']);
    expect(picked.map((c) => c.id).sort()).toEqual(['n1', 'n2', 't1', 't2', 't3', 't4']);
  });

  it('他に選べるものが無ければ上限を超えて埋める', () => {
    const candidates = [a('t1', 90, 'tech'), a('t2', 80, 'tech'), a('t3', 70, 'tech')];
    expect(pickDigestArticles(candidates, 3).map((c) => c.id)).toEqual(['t1', 't2', 't3']);
  });

  it('候補が枠より少なければあるだけ返す', () => {
    expect(pickDigestArticles([a('x', 50)], 8)).toHaveLength(1);
  });

  it('要約がまだ無い記事は後回しにする', () => {
    const picked = pickDigestArticles([a('none', null), a('low', 40)], 1);
    expect(picked.map((c) => c.id)).toEqual(['low']);
  });

  it('重要度が同じなら新しいものを優先する', () => {
    const picked = pickDigestArticles(
      [a('old', 50, null, '2026-08-01T00:00:00Z'), a('new', 50, null, '2026-08-12T00:00:00Z')],
      1,
    );
    expect(picked.map((c) => c.id)).toEqual(['new']);
  });

  it('件数が0なら何も選ばない', () => {
    expect(pickDigestArticles([a('x', 90)], 0)).toEqual([]);
  });

  it('フォルダの重みで順位が入れ替わる', () => {
    // 素の重要度は tech のほうが上でも、重みを半分にすれば life が先に来る。
    const picked = pickDigestArticles(
      [a('t', 80, 'tech', null, 50), a('l', 50, 'life', null, 100)],
      1,
    );
    expect(picked.map((c) => c.id)).toEqual(['l']);
  });

  it('重みが未設定なら素の重要度のまま', () => {
    const picked = pickDigestArticles([a('t', 80, 'tech'), a('l', 50, 'life')], 1);
    expect(picked.map((c) => c.id)).toEqual(['t']);
  });

  it('重み0のフォルダは、他に候補が無くても出さない', () => {
    // 掛け算だけで済ませると、枠の埋め戻しを通って結局載ってしまう。
    expect(pickDigestArticles([a('mute', 99, 'ads', null, 0)], 8)).toEqual([]);
  });

  it('重みを上げてもフォルダの上限は超えない', () => {
    const candidates = [
      a('t1', 90, 'tech', null, 200),
      a('t2', 89, 'tech', null, 200),
      a('t3', 88, 'tech', null, 200),
      a('n1', 40, 'news'),
    ];
    const picked = pickDigestArticles(candidates, 3);
    // 上限は ceil(3/3) = 1 件。残りは他のフォルダが尽きてから入る。
    expect(picked.map((c) => c.id)).toEqual(['t1', 't2', 'n1']);
  });

  it('effectiveScore は重みを掛けた点数を返す', () => {
    expect(effectiveScore(a('x', 80, 'f', null, 150))).toBe(120);
    expect(effectiveScore(a('x', 80, 'f'))).toBe(80);
    // 要約がまだ無い記事は 30 として扱う。
    expect(effectiveScore(a('x', null, 'f', null, 200))).toBe(60);
  });
});
