import { describe, expect, it } from 'vitest';
import { sanitizeSearch } from './search';

describe('sanitizeSearch', () => {
  it('普通の語はそのまま通す', () => {
    expect(sanitizeSearch('Rust 1.97')).toBe('Rust 1.97');
  });

  it('or フィルタを壊す記号を落とす', () => {
    // これを素通しすると or=(title.ilike.%a,b%) になって 400 が返る。
    expect(sanitizeSearch('a,b')).toBe('a b');
    expect(sanitizeSearch('AI (生成)')).toBe('AI 生成');
    expect(sanitizeSearch('say "hi"')).toBe('say hi');
  });

  it('全角の記号は残す', () => {
    // PostgREST の式を壊すのは ASCII のカンマ・括弧だけ。日本語の
    // 「、」「（）」まで落とすと、書かれたとおりに引けなくなる。
    expect(sanitizeSearch('AI（生成）')).toBe('AI（生成）');
    expect(sanitizeSearch('生成、要約')).toBe('生成、要約');
  });

  it('ilike のワイルドカードを落とす', () => {
    expect(sanitizeSearch('100%')).toBe('100');
    expect(sanitizeSearch('a_b')).toBe('a b');
  });

  it('前後と連続の空白をまとめる', () => {
    expect(sanitizeSearch('  生成  AI  ')).toBe('生成 AI');
  });

  it('記号だけなら空になる', () => {
    expect(sanitizeSearch('%%')).toBe('');
  });

  it('長すぎる語は切る', () => {
    // URL に3回（title / title_ja / content_text）並べるので、長いまま渡すと
    // 接続が切れるか 400 が返り、画面が500になる。実測で200字あたりが境目。
    expect(sanitizeSearch('あ'.repeat(500))).toHaveLength(100);
    expect(sanitizeSearch('あ'.repeat(50))).toHaveLength(50);
  });

  it('切った末尾に空白を残さない', () => {
    const s = sanitizeSearch('あ'.repeat(99) + ' ' + 'い'.repeat(50));
    expect(s).toBe('あ'.repeat(99));
  });
});
