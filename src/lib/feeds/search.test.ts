import { describe, expect, it } from 'vitest';
import { looksLikeUrl } from './search';

describe('looksLikeUrl', () => {
  it('スキーマ付きは URL', () => {
    expect(looksLikeUrl('https://nazology.kusuguru.co.jp/feed')).toBe(true);
    expect(looksLikeUrl('http://example.com')).toBe(true);
  });

  it('スキーマ無しのドメインも URL とみなす', () => {
    // アドレスバーからのコピーは https:// が落ちていることがある。
    expect(looksLikeUrl('nazology.kusuguru.co.jp')).toBe(true);
    expect(looksLikeUrl('example.com/feed')).toBe(true);
  });

  it('日本語の名前は検索に回す', () => {
    expect(looksLikeUrl('ナゾロジー')).toBe(false);
    expect(looksLikeUrl('東洋経済')).toBe(false);
    expect(looksLikeUrl('機械学習')).toBe(false);
  });

  it('空白を含むものは名前とみなす', () => {
    // 「Quanta Magazine」を URL として取りに行かせない。
    expect(looksLikeUrl('Quanta Magazine')).toBe(false);
    expect(looksLikeUrl('daily portal')).toBe(false);
  });

  it('ドットがあっても TLD に見えなければ名前', () => {
    expect(looksLikeUrl('Web.開発')).toBe(false);
    expect(looksLikeUrl('1.97')).toBe(false);
  });

  it('空文字は URL ではない', () => {
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('   ')).toBe(false);
  });
});
