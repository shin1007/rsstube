import { describe, expect, it } from 'vitest';
import { htmlToText } from './text';

describe('htmlToText', () => {
  it('段落を空行で区切る', () => {
    // textContent だと「段落1段落2」になってしまうところ。
    expect(htmlToText('<p>段落1</p><p>段落2</p>')).toBe('段落1\n\n段落2');
  });

  it('そもそも中身が取れる（linkedom は完全な文書の形を要求する）', () => {
    // 以前は <body> だけを渡していて、常に空文字が返っていた。
    expect(htmlToText('<div>本文</div>')).not.toBe('');
  });

  it('元HTMLの改行やインデントに左右されない', () => {
    // 同じ内容なら、書き方が違っても同じ結果になること。
    const 詰めて書いた = '<p>あ</p><p>い</p>';
    const 改行を入れた = '<p>あ</p>\n\n  <p>い</p>\n';
    expect(htmlToText(改行を入れた)).toBe(htmlToText(詰めて書いた));
  });

  it('見出し・リスト・引用も段落として切る', () => {
    expect(htmlToText('<h2>見出し</h2><ul><li>一つ目</li><li>二つ目</li></ul>')).toBe(
      '見出し\n\n一つ目\n\n二つ目',
    );
  });

  it('行内の要素では切らない', () => {
    // リンクや強調で文が分断されると読めなくなる。
    expect(htmlToText('<p>これは<a href="#">リンク</a>を含む文です</p>')).toBe(
      'これはリンクを含む文です',
    );
  });

  it('br は改行にする', () => {
    expect(htmlToText('<p>一行目<br>二行目</p>')).toBe('一行目\n\n二行目');
  });

  it('script や style の中身は捨てる', () => {
    expect(htmlToText('<p>本文</p><script>var x = 1;</script><style>.a{}</style>')).toBe('本文');
  });

  it('空の段落は落とす', () => {
    expect(htmlToText('<p>本文</p><p></p><p>  </p><p>続き</p>')).toBe('本文\n\n続き');
  });

  it('段落の中の空白は詰める', () => {
    expect(htmlToText('<p>語   と\n\n  語</p>')).toBe('語 と 語');
  });

  it('タグが無ければそのまま', () => {
    expect(htmlToText('ただの文字列')).toBe('ただの文字列');
  });

  it('空の入力は空', () => {
    expect(htmlToText('')).toBe('');
  });
});
