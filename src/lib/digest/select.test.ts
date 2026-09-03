import { describe, expect, it } from 'vitest';
import { pickDigestArticles, type DigestCandidate } from './select';

const a = (
  id: string,
  publishedAt: string | null = null,
  feedId = 'f1',
  createdAt: string | null = null,
): DigestCandidate => ({ id, publishedAt, feedId, createdAt });

/** 新しい順に並ぶよう、1件ずつ1時間ずらした時刻を作る。 */
const at = (hoursAgo: number) => new Date(Date.UTC(2026, 7, 30, 12 - hoursAgo)).toISOString();

describe('pickDigestArticles', () => {
  it('新しい順に選ぶ', () => {
    const picked = pickDigestArticles([a('old', at(5)), a('new', at(0)), a('mid', at(2))], 2);
    expect(picked.map((c) => c.id)).toEqual(['new', 'mid']);
  });

  it('1つのフィードで枠を独占させない', () => {
    // 更新の速いフィードが上位を占めていても、他のフィードにも枠が回る。
    // 動いたフィードは2本、枠は4つ → 上限は ceil(4/2) = 2 件。
    const candidates = [
      a('t1', at(0), 'tech'),
      a('t2', at(1), 'tech'),
      a('t3', at(2), 'tech'),
      a('t4', at(3), 'tech'),
      a('n1', at(4), 'news'),
      a('n2', at(5), 'news'),
    ];
    const picked = pickDigestArticles(candidates, 4);
    expect(picked.map((c) => c.id)).toEqual(['t1', 't2', 'n1', 'n2']);
  });

  it('上限はその日に動いたフィードの数から決まる', () => {
    // 4本が動いて枠が4つなら ceil(4/4) = 1 件まで。多いフィードでも1件で止まる。
    const many = [
      ...['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => a(id, at(i), 'a')),
      a('b1', at(5), 'b'),
      a('c1', at(6), 'c'),
      a('d1', at(7), 'd'),
    ];
    const picked = pickDigestArticles(many, 4);
    expect(picked.map((c) => c.id)).toEqual(['a1', 'b1', 'c1', 'd1']);
  });

  it('上限で枠が余ったら、はみ出したぶんで埋め戻す', () => {
    // **上限は枠を空けておくための仕組みではない。** 他に選べるものが無ければ
    // 超えて入れる。空けたままにすると、静かな日ほどダイジェストが痩せる。
    const many = [
      ...['a1', 'a2', 'a3', 'a4'].map((id, i) => a(id, at(i), 'a')),
      a('b1', at(5), 'b'),
    ];
    // 2本が動いて枠は4つ → 上限 ceil(4/2) = 2。a は2件で止まるが、b が尽きるので
    // 残り1枠は a の3件目で埋まる。
    const picked = pickDigestArticles(many, 4);
    expect(picked.map((c) => c.id)).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('動いたフィードが1本だけなら、その1本で埋める', () => {
    // 他に選べるものが無いのだから、上限で空けておく意味は無い。
    const only = ['x1', 'x2', 'x3'].map((id, i) => a(id, at(i), 'solo'));
    expect(pickDigestArticles(only, 3).map((c) => c.id)).toEqual(['x1', 'x2', 'x3']);
  });

  it('フィードが枠より多ければ1本ずつになる', () => {
    const wide = ['p', 'q', 'r', 's', 't'].map((id, i) => a(id, at(i), id));
    const picked = pickDigestArticles(wide, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((c) => c.feedId)).size).toBe(3);
  });

  it('候補が枠より少なければあるだけ返す', () => {
    expect(pickDigestArticles([a('x', at(0))], 8)).toHaveLength(1);
  });

  it('published_at が無ければ取り込んだ時刻で並べる', () => {
    const picked = pickDigestArticles([a('none', null, 'f1', at(0)), a('old', at(9))], 1);
    expect(picked.map((c) => c.id)).toEqual(['none']);
  });

  it('どちらの時刻も無い記事は最後尾に回る', () => {
    expect(pickDigestArticles([a('blank'), a('dated', at(9))], 1).map((c) => c.id)).toEqual(['dated']);
  });

  it('同時刻でも並びが決まる（作り直しても同じものが選ばれる）', () => {
    // 省庁や自治体は同じ時刻でまとめて出す。決着を付けないと実行計画次第で変わる。
    const same = at(0);
    const first = pickDigestArticles([a('b', same), a('c', same), a('a', same)], 2);
    const again = pickDigestArticles([a('c', same), a('a', same), a('b', same)], 2);
    expect(first.map((c) => c.id)).toEqual(again.map((c) => c.id));
  });

  it('件数が0なら何も選ばない', () => {
    expect(pickDigestArticles([a('x', at(0))], 0)).toEqual([]);
  });
});
