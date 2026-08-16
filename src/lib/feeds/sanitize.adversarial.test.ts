import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

/**
 * 消毒の敵対的な確認。
 *
 * 記事本文は第三者が書いた HTML をそのまま自分のページで描いている。
 * 許可リスト方式なので原理的には強いが、「許可したタグの中で悪さができないか」は
 * 別の話なので、実際に食わせて確かめる。
 *
 * ここが破れると、記事を1本開くだけでセッションを抜かれる。
 */

/** 出力に危険なものが残っていないか。 */
function isClean(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    !lower.includes('<script') &&
    !lower.includes('javascript:') &&
    !lower.includes('onerror') &&
    !lower.includes('onload') &&
    !lower.includes('onclick') &&
    !lower.includes('onmouseover') &&
    !lower.includes('<style') &&
    !lower.includes('<form') &&
    !lower.includes('<input')
  );
}

describe('消毒（敵対的な入力）', () => {
  const attacks: [string, string][] = [
    ['素のscript', '<script>alert(1)</script>'],
    ['imgのonerror', '<img src=x onerror=alert(1)>'],
    ['大文字小文字を混ぜたonerror', '<IMG SRC=x OnErRoR=alert(1)>'],
    ['svgのonload', '<svg onload=alert(1)>'],
    ['javascriptリンク', '<a href="javascript:alert(1)">押して</a>'],
    ['大文字のJavaScriptリンク', '<a href="JaVaScRiPt:alert(1)">押して</a>'],
    ['空白入りのjavascript', '<a href="java\tscript:alert(1)">押して</a>'],
    ['data URLのiframe', '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>'],
    ['許可していないiframe', '<iframe src="https://evil.example/x"></iframe>'],
    ['formとinput', '<form action="https://evil.example"><input name="password"></form>'],
    ['style要素', '<style>body{display:none}</style>'],
    ['style属性', '<p style="position:fixed;inset:0;background:red">覆う</p>'],
    ['objectとembed', '<object data="x.swf"></object><embed src="x.swf">'],
    ['metaによる転送', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ['baseの差し替え', '<base href="https://evil.example/">'],
    ['入れ子で隠したscript', '<div><p><script>alert(1)</script></p></div>'],
    ['壊れたタグ', '<img src=x onerror=alert(1)'],
    ['コメントに隠す', '<!--<script>alert(1)</script>-->'],
    ['srcsetの汚染', '<img srcset="javascript:alert(1)">'],
    ['onfocusとautofocus', '<p onfocus=alert(1) autofocus tabindex=0>x</p>'],
  ];

  for (const [name, html] of attacks) {
    it(name, () => {
      const out = sanitizeHtml(html, 'https://example.com/a');
      expect(isClean(out), `残った: ${out}`).toBe(true);
    });
  }

  it('読むために要るものは残る', () => {
    const out = sanitizeHtml(
      '<p>本文です。<a href="/next">続き</a></p>' +
        '<img src="/photo.jpg" alt="写真">' +
        '<blockquote>引用</blockquote>' +
        '<ul><li>項目</li></ul>' +
        '<table><tr><td>表</td></tr></table>',
      'https://example.com/a',
    );
    expect(out).toContain('本文です');
    expect(out).toContain('href="https://example.com/next"');
    expect(out).toContain('src="https://example.com/photo.jpg"');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<li>');
    expect(out).toContain('<td>');
  });

  it('許可した動画は埋め込みが残り、sandbox が付く', () => {
    const out = sanitizeHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>', 'https://example.com/a');
    expect(out).toContain('youtube.com/embed/abc');
    expect(out).toContain('sandbox');
  });

  it('外部リンクは元のタブを触れない', () => {
    const out = sanitizeHtml('<a href="https://other.example/x">外</a>', 'https://example.com/a');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('画像は参照元を送らない', () => {
    const out = sanitizeHtml('<img src="https://tracker.example/p.gif">', 'https://example.com/a');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });
});
