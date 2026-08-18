import { pickImageFromDocument, pickImageFromRss } from '@/lib/feeds/image';
import { parseHTML } from 'linkedom';
import { describe, expect, test } from 'vitest';

const BASE = 'https://example.com/news/1';

function doc(html: string) {
  return parseHTML(`<!doctype html><html><head>${html}</head><body></body></html>`).document;
}

describe('pickImageFromDocument', () => {
  test('og:image を拾う', () => {
    expect(
      pickImageFromDocument(doc('<meta property="og:image" content="/img/a.jpg">'), BASE),
    ).toBe('https://example.com/img/a.jpg');
  });

  test('og:image が無ければ twitter:image に下がる', () => {
    expect(
      pickImageFromDocument(
        doc('<meta name="twitter:image" content="https://cdn.example.net/b.png">'),
        BASE,
      ),
    ).toBe('https://cdn.example.net/b.png');
  });

  test('og:image を twitter:image より優先する', () => {
    expect(
      pickImageFromDocument(
        doc(
          '<meta name="twitter:image" content="/t.png"><meta property="og:image" content="/o.png">',
        ),
        BASE,
      ),
    ).toBe('https://example.com/o.png');
  });

  test('何も無ければ null', () => {
    expect(pickImageFromDocument(doc('<title>x</title>'), BASE)).toBeNull();
  });

  // 計測用ビーコンやロゴを掴むと、スライドが1x1の点や社章で埋まる。
  test('明らかに記事の絵でないものは捨てる', () => {
    expect(
      pickImageFromDocument(doc('<meta property="og:image" content="/img/1x1.gif">'), BASE),
    ).toBeNull();
    expect(
      pickImageFromDocument(doc('<meta property="og:image" content="/assets/logo.svg">'), BASE),
    ).toBeNull();
  });

  // data: は Storage へ写す前提に合わない（巨大な base64 が DB に入るだけ）。
  test('http/https 以外は捨てる', () => {
    expect(
      pickImageFromDocument(
        doc('<meta property="og:image" content="data:image/png;base64,AAAA">'),
        BASE,
      ),
    ).toBeNull();
  });
});

describe('pickImageFromRss', () => {
  test('画像の enclosure を拾う', () => {
    expect(
      pickImageFromRss({ enclosure: { url: '/e.jpg', type: 'image/jpeg' } }, BASE),
    ).toBe('https://example.com/e.jpg');
  });

  test('音声の enclosure は拾わない（ポッドキャストの mp3）', () => {
    expect(
      pickImageFromRss({ enclosure: { url: '/e.mp3', type: 'audio/mpeg' } }, BASE),
    ).toBeNull();
  });

  test('enclosure が無ければ本文の1枚目に下がる', () => {
    expect(
      pickImageFromRss({ contentHtml: '<p>a</p><img src="https://x.test/c.png"> <img src="/d.png">' }, BASE),
    ).toBe('https://x.test/c.png');
  });

  test('絵が無ければ null', () => {
    expect(pickImageFromRss({ contentHtml: '<p>文字だけ</p>' }, BASE)).toBeNull();
  });
});
