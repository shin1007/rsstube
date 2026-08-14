import { describe, expect, it } from 'vitest';
import { shouldAutoRelocate } from './relocate';

describe('shouldAutoRelocate', () => {
  it('一時的な不調では動かない', () => {
    // 相手が1〜2回落ちるのは珍しくない。そのたびに探し直すと、
    // 落ちているサイトへ余計なリクエストを何度も投げることになる。
    expect(shouldAutoRelocate(0)).toBe(false);
    expect(shouldAutoRelocate(1)).toBe(false);
    expect(shouldAutoRelocate(2)).toBe(false);
  });

  it('3回続けて失敗したら1回試す', () => {
    expect(shouldAutoRelocate(3)).toBe(true);
  });

  it('直後は繰り返さない', () => {
    for (const n of [4, 5, 6, 7, 8, 9]) expect(shouldAutoRelocate(n)).toBe(false);
  });

  it('その後は10回ごとに試す', () => {
    // サイト側が直ることもあるので、諦めきらない程度に繰り返す。
    expect(shouldAutoRelocate(10)).toBe(true);
    expect(shouldAutoRelocate(20)).toBe(true);
    expect(shouldAutoRelocate(30)).toBe(true);
    expect(shouldAutoRelocate(25)).toBe(false);
  });
});
