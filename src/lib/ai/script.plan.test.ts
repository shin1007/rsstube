import { describe, expect, test } from 'vitest';
import { plan } from './script';

/**
 * 尺と枠の割り当て。
 *
 * ここが「1本1本の読み上げ」と「まとめ番組」を分けている唯一の場所で、
 * 数字を1つ動かすと出来上がりの長さと構成が変わる。プロンプトの効きは
 * 実測でしか分からないが、**割り当ての算数は固定しておく**。
 */
describe('plan', () => {
  test('記事1本は深掘り。まとめ番組にしない', () => {
    const p = plan(1);
    expect(p.kind).toBe('deep');
    expect(p.slides).toBe(5);
  });

  test('ダイジェストは15分のまとめ番組', () => {
    // 実際の運用値（digest_count = 8、素材が少ない日は6件）。
    for (const n of [6, 8]) {
      const p = plan(n);
      expect(p.kind).toBe('roundup');
      expect(p.minutes).toBe(15);
      expect(p.chars).toBe(5_100);
    }
  });

  test('話題は記事より少ない。同数だと1記事1話題に戻る', () => {
    expect(plan(6).topics).toBe(4);
    expect(plan(8).topics).toBe(6);
    for (const n of [4, 6, 8, 12]) expect(plan(n).topics).toBeLessThan(n);
  });

  test('スライドは表紙とまとめのぶんだけ話題より多い', () => {
    for (const n of [2, 4, 6, 8, 12, 30]) {
      const p = plan(n);
      expect(p.slides).toBe(p.topics + 2);
    }
  });

  test('件数がいくつでも上限を超えない', () => {
    for (const n of [2, 6, 8, 12, 30, 200]) {
      const p = plan(n);
      expect(p.slides).toBeLessThanOrEqual(12);
      expect(p.lines).toBeLessThanOrEqual(80);
      expect(p.minutes).toBeLessThanOrEqual(15);
    }
  });

  test('素材が少ない日でも番組の形は保つ', () => {
    const p = plan(2);
    expect(p.minutes).toBe(6);
    expect(p.topics).toBe(2);
  });

  test('話題ごとの割り当てを全部足すと目安の字数になる', () => {
    for (const n of [2, 6, 8, 12]) {
      const p = plan(n);
      // 冒頭350字＋締め250字を引いた残りを話題で割っている。
      expect(p.charsPerTopic * p.topics + 600).toBeCloseTo(p.chars, -1);
    }
  });

  test('枠の数と字数が食い違わない（1発話が60〜140字に収まる）', () => {
    // プロンプトで頼んでいる1発話の長さは60〜140字。枠が少なすぎると
    // 字数を守るために1発話が長くなり、息継ぎの無い読み上げになる。
    // 逆に多すぎると、枠を埋めるために1発話が短く薄くなる。
    for (const n of [1, 2, 6, 8, 12]) {
      const p = plan(n);
      expect(p.chars / p.lines).toBeGreaterThanOrEqual(60);
      expect(p.chars / p.lines).toBeLessThanOrEqual(140);
    }
  });
});
