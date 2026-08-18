import { estimateFinishAt, formatEta, runsRemaining } from '@/lib/media/eta';
import { describe, expect, test } from 'vitest';

const base = { doneSegments: 0, totalSegments: 0 } as const;

describe('runsRemaining', () => {
  test('できあがったものには出さない', () => {
    expect(runsRemaining({ ...base, status: 'ready' })).toBeNull();
    expect(runsRemaining({ ...base, status: 'failed' })).toBeNull();
  });

  // 台本ができるまではセグメント数が分からないので、仮置きで見積もる。
  test('順番待ち・台本づくりは仮置きで見積もる', () => {
    expect(runsRemaining({ ...base, status: 'queued' })).toBe(5);
    expect(runsRemaining({ ...base, status: 'scripting' })).toBe(5);
  });

  test('合成中は残りのセグメント数から出す', () => {
    // 残り5件を1回1.5件ずつ → 4回。
    expect(
      runsRemaining({ status: 'synthesizing', doneSegments: 0, totalSegments: 5 }),
    ).toBe(4);
    expect(
      runsRemaining({ status: 'synthesizing', doneSegments: 3, totalSegments: 5 }),
    ).toBe(2);
  });

  // 全部揃っていても ready になるのは次の回。0回と言うと「もう出来ている」に見える。
  test('残り0でもまだ合成中なら1回は見込む', () => {
    expect(
      runsRemaining({ status: 'synthesizing', doneSegments: 5, totalSegments: 5 }),
    ).toBe(1);
  });
});

describe('estimateFinishAt', () => {
  test('1回につき5分で先に伸ばす', () => {
    const now = new Date('2026-08-18T10:00:00Z');
    const at = estimateFinishAt(
      { status: 'synthesizing', doneSegments: 3, totalSegments: 5 },
      now,
    );
    expect(at?.toISOString()).toBe('2026-08-18T10:10:00.000Z');
  });

  test('終わっているものには出さない', () => {
    expect(estimateFinishAt({ ...base, status: 'ready' })).toBeNull();
  });
});

test('formatEta は日本時間で出す', () => {
  // 10:00 UTC = 19:00 JST。
  expect(formatEta(new Date('2026-08-18T10:00:00Z'))).toBe('19:00');
});
