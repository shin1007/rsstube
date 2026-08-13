import { describe, expect, it } from 'vitest';
import { extractFeedLinks, normalizeInput } from './discover';

describe('normalizeInput', () => {
  it('スキーマが無ければ補う', () => {
    // ブラウザのアドレスバーからコピーすると https:// が落ちていることがある。
    expect(normalizeInput('nazology.kusuguru.co.jp')).toBe('https://nazology.kusuguru.co.jp/');
  });

  it('前後の空白を落とす', () => {
    expect(normalizeInput('  https://example.com/feed  ')).toBe('https://example.com/feed');
  });

  it('http はそのまま通す', () => {
    expect(normalizeInput('http://example.com/feed')).toBe('http://example.com/feed');
  });

  it('URL にならないものは null', () => {
    expect(normalizeInput('')).toBeNull();
    expect(normalizeInput('   ')).toBeNull();
  });

  it('http(s) 以外のスキーマは通さない', () => {
    // javascript: や file: を叩きに行かないこと。
    expect(normalizeInput('javascript:alert(1)')).toBeNull();
    expect(normalizeInput('file:///etc/passwd')).toBeNull();
  });
});

describe('extractFeedLinks', () => {
  const base = 'https://example.com/blog/';

  it('rel=alternate の RSS を拾う', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`;
    expect(extractFeedLinks(html, base)).toEqual(['https://example.com/feed.xml']);
  });

  it('相対パスをページのURLで解決する', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="feed">`;
    expect(extractFeedLinks(html, base)).toEqual(['https://example.com/blog/feed']);
  });

  it('Atom も拾う', () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`;
    expect(extractFeedLinks(html, base)).toEqual(['https://example.com/atom.xml']);
  });

  it('属性の順序が違っても拾う', () => {
    const html = `<link href="/f.xml" type="application/rss+xml" rel="alternate">`;
    expect(extractFeedLinks(html, base)).toEqual(['https://example.com/f.xml']);
  });

  it('複数あれば順に返す', () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" title="記事" href="/feed">
      <link rel="alternate" type="application/rss+xml" title="コメント" href="/comments/feed">`;
    expect(extractFeedLinks(html, base)).toEqual([
      'https://example.com/feed',
      'https://example.com/comments/feed',
    ]);
  });

  it('同じURLは1回だけ', () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="/feed">
      <link rel="alternate" type="application/atom+xml" href="/feed">`;
    expect(extractFeedLinks(html, base)).toHaveLength(1);
  });

  it('フィードでない link は拾わない', () => {
    // スタイルシートや正規URLまで叩きに行かないこと。
    const html = `
      <link rel="stylesheet" href="/style.css">
      <link rel="canonical" href="https://example.com/blog/">
      <link rel="icon" href="/favicon.ico">`;
    expect(extractFeedLinks(html, base)).toEqual([]);
  });

  it('href が無い link は飛ばす', () => {
    expect(extractFeedLinks(`<link rel="alternate" type="application/rss+xml">`, base)).toEqual([]);
  });

  it('link が1つも無ければ空', () => {
    expect(extractFeedLinks('<html><body>本文だけ</body></html>', base)).toEqual([]);
  });
});
