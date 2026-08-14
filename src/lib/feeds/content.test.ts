import { describe, expect, it } from 'vitest';
import { contentHash, normalizeContent } from './content';

const long = (s: string) => s.repeat(Math.ceil(120 / s.length));

describe('normalizeContent', () => {
  it('空白の詰め方を揃える', () => {
    // 取得のたびに改行やインデントが揺れるので、そこで差が出ないようにする。
    expect(normalizeContent('  本文  が\n\n続く \t ')).toBe('本文 が 続く');
  });
});

describe('contentHash', () => {
  it('同じ本文は同じハッシュ', () => {
    const a = long('アクセスが集中しています。しばらく時間をおいてお試しください。');
    expect(contentHash(a)).toBe(contentHash(a));
  });

  it('空白の詰まり方が違っても同じとみなす', () => {
    // 取得のたびに改行やインデントは揺れる。そこで別物にならないことを見る
    // （空白そのものが増減すれば別の文字列になるのは正しい）。
    const a = `${'記事の本文です。'.repeat(20)}\n\n続き`;
    const b = a.replace(/\n\n/g, '  \t  ');
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('本文が違えば別のハッシュ', () => {
    // 本物の記事どうしは一致しない。ここが誤検出しない根拠。
    expect(contentHash(long('記事Aの本文。'))).not.toBe(contentHash(long('記事Bの本文。')));
  });

  it('短すぎるものはハッシュを作らない', () => {
    // 100字未満は抽出失敗として扱うので、比べる意味が無い。
    expect(contentHash('短い')).toBeNull();
    expect(contentHash('')).toBeNull();
  });

  it('ちょうど100字なら作る', () => {
    expect(contentHash('あ'.repeat(100))).not.toBeNull();
    expect(contentHash('あ'.repeat(99))).toBeNull();
  });
});
