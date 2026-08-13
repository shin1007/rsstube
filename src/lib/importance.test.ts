import { describe, expect, it } from 'vitest';
import { IMPORTANCE_CRITERIA, IMPORTANCE_HELP, importanceTier, importanceTitle } from './importance';

describe('importanceTier', () => {
  it('高い順に段が上がる', () => {
    expect(importanceTier(100).label).toBe('高');
    expect(importanceTier(85).label).toBe('高');
    expect(importanceTier(84).label).toBe('やや高');
    expect(importanceTier(70).label).toBe('やや高');
    expect(importanceTier(69).label).toBe('並');
    expect(importanceTier(40).label).toBe('並');
    expect(importanceTier(39).label).toBe('低');
    expect(importanceTier(0).label).toBe('低');
  });

  it('一覧にバッジを出すのは70以上だけ', () => {
    expect(importanceTier(70).badge).toBe(true);
    expect(importanceTier(69).badge).toBe(false);
  });
});

describe('importanceTitle', () => {
  it('段・点数・基準がすべて入る', () => {
    const title = importanceTitle(90);
    expect(title).toContain('高');
    expect(title).toContain('90');
    expect(title).toContain('100');
    for (const c of IMPORTANCE_CRITERIA) expect(title).toContain(c);
  });
});

describe('IMPORTANCE_HELP', () => {
  it('平均が50であることと基準を述べる', () => {
    expect(IMPORTANCE_HELP).toContain('50');
    for (const c of IMPORTANCE_CRITERIA) expect(IMPORTANCE_HELP).toContain(c);
  });
});
