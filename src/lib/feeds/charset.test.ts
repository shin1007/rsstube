import { describe, expect, it } from 'vitest';
import { decodeBody, detectCharset } from './charset';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('detectCharset', () => {
  it('Content-Type の charset を最優先する', () => {
    expect(detectCharset('text/html; charset=Shift_JIS', bytes(''))).toBe('shift_jis');
  });

  it('表記ゆれを寄せる', () => {
    // 同じものが何通りにも書かれる。
    for (const label of ['Shift-JIS', 'x-sjis', 'SJIS', 'windows-31j', 'cp932']) {
      expect(detectCharset(`text/html; charset=${label}`, bytes(''))).toBe('shift_jis');
    }
    expect(detectCharset('text/html; charset=EUC-JP', bytes(''))).toBe('euc-jp');
  });

  it('Content-Type に charset が無ければ meta を見る', () => {
    // 厚労省がこれ。ヘッダは text/html だけで、meta にだけ書いてある。
    const html = bytes('<html><head><meta charset="shift_jis"><title>統計</title>');
    expect(detectCharset('text/html', html)).toBe('shift_jis');
  });

  it('古い書き方の meta も読む', () => {
    const html = bytes(
      '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">',
    );
    expect(detectCharset(null, html)).toBe('euc-jp');
  });

  it('XML 宣言も読む（RSS/Atom はこちら）', () => {
    expect(detectCharset(null, bytes('<?xml version="1.0" encoding="Shift_JIS"?><rss>'))).toBe(
      'shift_jis',
    );
  });

  it('BOM があれば中身より優先する', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('<meta charset="euc-jp">')]);
    expect(detectCharset(null, withBom)).toBe('utf-8');
  });

  it('何も分からなければ UTF-8', () => {
    expect(detectCharset(null, bytes('<html><body>本文</body></html>'))).toBe('utf-8');
  });

  it('Node が知らない名前は採用しない', () => {
    // 存在しない charset で TextDecoder が投げると、取得そのものが失敗する。
    expect(detectCharset('text/html; charset=x-unknown-9999', bytes(''))).toBe('utf-8');
  });
});

describe('decodeBody', () => {
  it('Shift_JIS を正しく読む', () => {
    // 「日本語」の Shift_JIS 表現。
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    expect(decodeBody('text/html; charset=shift_jis', sjis)).toBe('日本語');
  });

  it('UTF-8 として読むと化けるものが、正しく読める', () => {
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    // 宣言が無ければ UTF-8 扱いになり、置換文字だらけになる（これが従来の挙動）。
    expect(decodeBody(null, sjis)).not.toBe('日本語');
    // meta があれば正しく読める。
    const withMeta = new Uint8Array([...bytes('<meta charset="shift_jis">'), ...sjis]);
    expect(decodeBody('text/html', withMeta)).toContain('日本語');
  });

  it('壊れたバイトがあっても投げない', () => {
    const broken = new Uint8Array([0xff, 0xfe, 0x00, 0x93, 0xfa]);
    expect(() => decodeBody('text/html; charset=utf-8', broken)).not.toThrow();
  });
});
