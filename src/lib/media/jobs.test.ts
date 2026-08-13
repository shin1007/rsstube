import { describe, expect, it } from 'vitest';
import { groupIntoSegments } from './jobs';
import type { ScriptLine } from '@/lib/ai/script';

const line = (slide: number, chars: number, speaker: 'A' | 'B' = 'A'): ScriptLine => ({
  speaker,
  slide,
  text: 'あ'.repeat(chars),
});

describe('groupIntoSegments', () => {
  it('スライドごとに分ける', () => {
    const groups = groupIntoSegments([line(0, 50), line(1, 50), line(1, 50)], 2);
    expect(groups.map((g) => g.slide)).toEqual([0, 1]);
    expect(groups[1].lines).toHaveLength(2);
  });

  it('発話が無いスライドは飛ばす', () => {
    // モデルがスライドだけ作って何も喋らないことがある。
    const groups = groupIntoSegments([line(0, 10), line(2, 10)], 3);
    expect(groups.map((g) => g.slide)).toEqual([0, 2]);
  });

  it('長いスライドは複数のセグメントに割る', () => {
    // スライドが1枚しか返らないと、割らなければ1回のTTSが数分になる。
    const lines = Array.from({ length: 10 }, () => line(0, 200));
    const groups = groupIntoSegments(lines, 1);

    expect(groups.length).toBeGreaterThan(1);
    // どのセグメントも同じスライドを指したまま。
    expect(groups.every((g) => g.slide === 0)).toBe(true);
    // 発話は1つも落ちない。
    expect(groups.reduce((n, g) => n + g.lines.length, 0)).toBe(10);
  });

  it('発話の途中では切らない', () => {
    // 1発話だけで上限を超えていても、それ単体で1セグメントにする。
    const groups = groupIntoSegments([line(0, 2000)], 1);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(1);
  });

  it('割った順番は台本の順を保つ', () => {
    const lines = [line(0, 400), line(0, 400), line(0, 400)];
    const groups = groupIntoSegments(lines, 1);
    const flat = groups.flatMap((g) => g.lines);
    expect(flat).toEqual(lines);
  });

  it('台本が空なら何も作らない', () => {
    expect(groupIntoSegments([], 3)).toEqual([]);
  });
});
