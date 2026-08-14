import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

/**
 * ここは記事HTMLをそのまま描画する箇所の防具なので、
 * 「通ってはいけないもの」を重点的に固定する。
 */
describe('sanitizeHtml — 危ないものを落とす', () => {
  it('script を中身ごと消す', () => {
    const out = sanitizeHtml('<p>本文</p><script>alert(1)</script>');
    expect(out).toContain('本文');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('script');
  });

  it('on* 属性を落とす', () => {
    const out = sanitizeHtml('<p onclick="alert(1)" onmouseover="x()">本文</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('本文');
  });

  it('javascript: のリンクを無効にする', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">押して</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('押して'); // 文字は残す
  });

  it('data: のURLを通さない', () => {
    const out = sanitizeHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(out).not.toContain('data:');
  });

  it('form や input を消す（偽の入力欄を出させない）', () => {
    const out = sanitizeHtml('<form><input name="password"><button>送信</button></form><p>本文</p>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).toContain('本文');
  });

  it('style 属性を落とす', () => {
    const out = sanitizeHtml('<p style="position:fixed;top:0">本文</p>');
    expect(out).not.toContain('style');
  });

  it('知らないタグは枠だけ外して中身を残す', () => {
    const out = sanitizeHtml('<custom-tag>大事な文</custom-tag>');
    expect(out).toContain('大事な文');
    expect(out).not.toContain('custom-tag');
  });
});

describe('sanitizeHtml — 読むのに要るものは残す', () => {
  it('段落・見出し・リストを残す', () => {
    const out = sanitizeHtml('<h2>見出し</h2><p>本文</p><ul><li>項目</li></ul>');
    expect(out).toContain('<h2>見出し</h2>');
    expect(out).toContain('<p>本文</p>');
    expect(out).toContain('<li>項目</li>');
  });

  it('リンクは別タブで開き、元のタブを触らせない', () => {
    const out = sanitizeHtml('<a href="https://example.com/a">リンク</a>');
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('画像は遅延読み込みで、参照元を送らない', () => {
    const out = sanitizeHtml('<img src="https://example.com/a.jpg" alt="説明">');
    expect(out).toContain('src="https://example.com/a.jpg"');
    expect(out).toContain('alt="説明"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });

  it('相対パスを記事のURLで解決する', () => {
    const out = sanitizeHtml('<img src="/img/a.jpg">', 'https://example.com/news/1');
    expect(out).toContain('https://example.com/img/a.jpg');
  });

  it('表とコードを残す', () => {
    const out = sanitizeHtml('<table><tr><td colspan="2">値</td></tr></table><pre><code>x=1</code></pre>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('<code>x=1</code>');
  });
});

describe('sanitizeHtml — 動画の埋め込み', () => {
  it('YouTube は残し、中でできることを絞る', () => {
    const out = sanitizeHtml('<iframe src="https://www.youtube.com/embed/abc123"></iframe>');
    expect(out).toContain('youtube.com/embed/abc123');
    expect(out).toContain('sandbox=');
    expect(out).toContain('loading="lazy"');
  });

  it('Vimeo とニコニコも残す', () => {
    expect(sanitizeHtml('<iframe src="https://player.vimeo.com/video/1"></iframe>')).toContain('iframe');
    expect(sanitizeHtml('<iframe src="https://embed.nicovideo.jp/watch/sm1"></iframe>')).toContain('iframe');
  });

  it('知らない相手の iframe はリンクに置き換える', () => {
    // 中で何をされるか分からないので枠は消すが、開く手段は残す。
    const out = sanitizeHtml('<iframe src="https://evil.example/x"></iframe>');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('href="https://evil.example/x"');
  });

  it('src の無い iframe は消す', () => {
    expect(sanitizeHtml('<iframe></iframe>')).toBe('');
  });
});
