import { describe, expect, it } from 'vitest';
import { isRedirect, permanentTarget } from './redirect';

describe('isRedirect', () => {
  it('リダイレクトの status を見分ける', () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirect(s)).toBe(true);
    for (const s of [200, 304, 404, 500]) expect(isRedirect(s)).toBe(false);
  });
});

describe('permanentTarget', () => {
  it('301 で辿り着いた先は覚える', () => {
    expect(permanentTarget([{ status: 301, to: 'https://new.example.com/feed' }])).toBe(
      'https://new.example.com/feed',
    );
  });

  it('308 も恒久的', () => {
    expect(permanentTarget([{ status: 308, to: 'https://b/feed' }])).toBe('https://b/feed');
  });

  it('301 が続いたら最後の行き先', () => {
    expect(
      permanentTarget([
        { status: 301, to: 'https://b/feed' },
        { status: 301, to: 'https://c/feed' },
      ]),
    ).toBe('https://c/feed');
  });

  it('302 は覚えない', () => {
    // 相手が「一時的」と言っているものを固定すると、戻ったときに追随できない。
    expect(permanentTarget([{ status: 302, to: 'https://b/feed' }])).toBeNull();
  });

  it('途中に一時的なものが混じったら覚えない', () => {
    expect(
      permanentTarget([
        { status: 301, to: 'https://b/feed' },
        { status: 302, to: 'https://c/feed' },
      ]),
    ).toBeNull();
  });

  it('リダイレクトが無ければ何も覚えない', () => {
    expect(permanentTarget([])).toBeNull();
  });
});
