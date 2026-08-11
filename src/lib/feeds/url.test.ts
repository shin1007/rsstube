import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeUrl, urlHash } from './url';

/**
 * 正規化の結果は articles.url_hash の一意キーになる。
 * ここが変わると「既読の記事が未読で再登場する」か「別記事が同じものと判定される」
 * のどちらかが起きるので、崩れやすい所を固定しておく。
 */

describe('normalizeUrl', () => {
  it('スキームとホストを小文字にし www を落とす', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/a')).toBe('https://example.com/a');
  });

  it('フラグメントを落とす', () => {
    expect(normalizeUrl('https://example.com/a#section-2')).toBe('https://example.com/a');
  });

  it('計測パラメータだけを落として残りは順序を揃える', () => {
    expect(normalizeUrl('https://example.com/a?b=2&utm_source=rss&a=1&fbclid=xyz')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });

  it('計測パラメータしか無ければクエリごと消える', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=rss&utm_medium=feed')).toBe(
      'https://example.com/a',
    );
  });

  it('末尾スラッシュの有無を吸収する（ルートは除く）', () => {
    expect(normalizeUrl('https://example.com/a/b/')).toBe(normalizeUrl('https://example.com/a/b'));
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('前後の空白を落とす', () => {
    expect(normalizeUrl('  https://example.com/a  ')).toBe('https://example.com/a');
  });

  it('URLとして壊れていても素通しでキーにできる', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });

  it('クエリの値は保持する（別記事を潰さない）', () => {
    expect(normalizeUrl('https://example.com/?p=1')).not.toBe(normalizeUrl('https://example.com/?p=2'));
  });

  it('パスの大文字小文字は区別する（別記事のことがある）', () => {
    expect(normalizeUrl('https://example.com/A')).not.toBe(normalizeUrl('https://example.com/a'));
  });
});

describe('urlHash', () => {
  it('正規化後の文字列の sha256 を返す', () => {
    const expected = createHash('sha256').update('https://example.com/a').digest('hex');
    expect(urlHash('https://WWW.example.com/a/?utm_source=rss')).toBe(expected);
  });

  it('表記の揺れた同じ記事は同じキーになる', () => {
    expect(urlHash('http://www.example.com/post/1/?utm_campaign=x#top')).toBe(
      urlHash('http://example.com/post/1'),
    );
  });

  it('スキームが違えば別キー（http と https を混ぜない）', () => {
    expect(urlHash('http://example.com/a')).not.toBe(urlHash('https://example.com/a'));
  });
});
