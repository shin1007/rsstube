import { describe, expect, it } from 'vitest';
import { browserUrl, fallbackChain } from './ExternalBrowser';

describe('browserUrl', () => {
  const url = 'https://example.jp/a/b?x=1&y=日本#h';

  it('Safari は x-safari- を前に付ける', () => {
    expect(browserUrl(url, 'safari')).toBe(`x-safari-${new URL(url).href}`);
  });
  it('Brave は url= に丸ごと入れる', () => {
    expect(browserUrl(url, 'brave')).toBe(
      `brave://open-url?url=${encodeURIComponent(new URL(url).href)}`,
    );
  });
  it('Chrome は https と http でスキームが違う', () => {
    expect(browserUrl('https://a.jp/p', 'chrome')).toBe('googlechromes://a.jp/p');
    expect(browserUrl('http://a.jp/p', 'chrome')).toBe('googlechrome://a.jp/p');
  });
  it('アプリ内・http(s) 以外・壊れた URL は書き替えない', () => {
    expect(browserUrl(url, 'inapp')).toBeNull();
    expect(browserUrl('mailto:a@b.jp', 'brave')).toBeNull();
    expect(browserUrl('not a url', 'brave')).toBeNull();
  });
});

describe('fallbackChain', () => {
  it('入っていないかもしれないブラウザは Safari を挟んでアプリ内に落とす', () => {
    expect(fallbackChain('brave')).toEqual(['brave', 'safari', 'inapp']);
    expect(fallbackChain('chrome')).toEqual(['chrome', 'safari', 'inapp']);
  });
  it('Safari はそのままアプリ内へ、アプリ内はそれだけ', () => {
    expect(fallbackChain('safari')).toEqual(['safari', 'inapp']);
    expect(fallbackChain('inapp')).toEqual(['inapp']);
  });
});
