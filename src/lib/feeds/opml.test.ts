import { describe, expect, it } from 'vitest';
import { buildOpml, parseOpml, type OpmlFeed } from './opml';

/**
 * 実際の書き出しファイルは属性の付き方も入れ子の深さもまちまちなので、
 * Inoreader / Feedly / 素朴な手書き の3系統を想定したサンプルで固定しておく。
 */

const INOREADER = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Foo Blog" title="Foo Blog"
               xmlUrl="https://foo.example/feed" htmlUrl="https://foo.example"/>
      <outline type="rss" text="Bar News" title="Bar News" xmlUrl="https://bar.example/rss"/>
    </outline>
    <outline type="rss" text="Baz" title="Baz" xmlUrl="https://baz.example/atom"/>
  </body>
</opml>`;

describe('parseOpml', () => {
  it('フォルダ配下のフィードにフォルダ名が付く', () => {
    const feeds = parseOpml(INOREADER);
    expect(feeds).toHaveLength(3);
    expect(feeds[0]).toEqual({
      title: 'Foo Blog',
      xmlUrl: 'https://foo.example/feed',
      htmlUrl: 'https://foo.example',
      folder: 'Tech',
    });
    expect(feeds[1].folder).toBe('Tech');
  });

  it('フォルダに入っていないフィードは folder が undefined', () => {
    const feeds = parseOpml(INOREADER);
    expect(feeds[2].title).toBe('Baz');
    expect(feeds[2].folder).toBeUndefined();
  });

  it('フォルダを抜けたあとのフィードに前のフォルダが残らない', () => {
    // stack の pop が効いていないと Baz が Tech 扱いになる。
    expect(parseOpml(INOREADER)[2].folder).toBeUndefined();
  });

  it('title が無ければ text を使う', () => {
    const feeds = parseOpml('<outline type="rss" text="Only Text" xmlUrl="https://a.example/f"/>');
    expect(feeds[0].title).toBe('Only Text');
  });

  it('title も text も無ければ URL をタイトルにする', () => {
    const feeds = parseOpml('<outline type="rss" xmlUrl="https://a.example/f"/>');
    expect(feeds[0].title).toBe('https://a.example/f');
  });

  it('シングルクォート属性も読む', () => {
    const feeds = parseOpml("<outline type='rss' title='Quoted' xmlUrl='https://a.example/f'/>");
    expect(feeds[0]).toMatchObject({ title: 'Quoted', xmlUrl: 'https://a.example/f' });
  });

  it('実体参照を戻す', () => {
    const feeds = parseOpml(
      '<outline type="rss" title="A &amp; B" xmlUrl="https://a.example/f?x=1&amp;y=2"/>',
    );
    expect(feeds[0].title).toBe('A & B');
    expect(feeds[0].xmlUrl).toBe('https://a.example/f?x=1&y=2');
  });

  it('同じフィードが複数フォルダにあっても1件に畳む', () => {
    const feeds = parseOpml(`
      <outline text="A"><outline type="rss" title="Dup" xmlUrl="https://d.example/f"/></outline>
      <outline text="B"><outline type="rss" title="Dup" xmlUrl="https://d.example/f"/></outline>`);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].folder).toBe('A');
  });

  it('xmlUrl を持たない outline はフィードとして拾わない', () => {
    expect(parseOpml('<outline text="Folder Only"></outline>')).toHaveLength(0);
  });

  it('フィードでない入力では空を返す', () => {
    expect(parseOpml('<opml><body></body></opml>')).toEqual([]);
  });
});

describe('buildOpml', () => {
  const feeds: OpmlFeed[] = [
    { title: 'Foo Blog', xmlUrl: 'https://foo.example/feed', htmlUrl: 'https://foo.example', folder: 'Tech' },
    { title: 'Baz', xmlUrl: 'https://baz.example/atom' },
  ];

  it('フォルダを入れ子の outline として書く', () => {
    const xml = buildOpml(feeds);
    expect(xml).toContain('<outline text="Tech" title="Tech">');
    expect(xml).toContain('</outline>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('属性値をエスケープする', () => {
    const xml = buildOpml([{ title: 'A & <B>', xmlUrl: 'https://a.example/f?x=1&y=2' }]);
    expect(xml).toContain('text="A &amp; &lt;B&gt;"');
    expect(xml).toContain('xmlUrl="https://a.example/f?x=1&amp;y=2"');
  });

  it('書き出して読み直すと同じ購読内容になる（往復）', () => {
    expect(parseOpml(buildOpml(feeds))).toEqual(feeds);
  });

  it('取り込んだOPMLを書き出して読み直しても保たれる', () => {
    const once = parseOpml(INOREADER);
    expect(parseOpml(buildOpml(once))).toEqual(once);
  });
});
