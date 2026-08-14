import { parseHTML } from 'linkedom';

/**
 * HTML から読める本文を作る。
 *
 * `textContent` を使ってはいけない。あれはブロック要素の境目に何も入れないので、
 * `<p>A</p><p>B</p>` が「AB」になる。段落が全部つながって出てくる一方で、
 * **元のHTMLの整形（タグ間の改行やインデント）はそのまま残る**。
 *
 * 結果として、見た目が書き手の HTML の書き方に左右される:
 *   改行を入れて書いてあるサイト  →  やたら改行が多い（デイリーポータルZ）
 *   詰めて書いてあるサイト        →  改行がまったく無く、文が壁になる
 *
 * どちらも読みにくいので、段落はこちらで組み直す。ブロック要素ごとに切り、
 * 中の空白は1つに詰め、段落と段落は空行1つでつなぐ。表示は pre-wrap なので、
 * ここで作った改行がそのまま見た目になる。
 */

/** ここで区切る要素。表示上まとまりとして扱われるもの。 */
const BLOCKS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'HR', 'BR',
]);

/** 中身を読まない要素。読み上げにも要約にも邪魔にしかならない。 */
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE']);

export function htmlToText(html: string): string {
  // linkedom は完全な文書の形を要求する。`<body>…</body>` だけを渡すと
  // **body が空のまま返ってきて、黙って空文字になる**。以前の実装がこれで、
  // RSS のフォールバックが常に空だった（結果、生のHTMLがそのまま保存されていた）。
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const blocks: string[] = [];
  let current = '';

  const flush = () => {
    const line = current.replace(/\s+/g, ' ').trim();
    if (line) blocks.push(line);
    current = '';
  };

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      // 3 = テキストノード
      if (child.nodeType === 3) {
        current += child.textContent ?? '';
        continue;
      }
      // 1 = 要素
      if (child.nodeType !== 1) continue;

      const tag = (child as Element).tagName?.toUpperCase() ?? '';
      if (SKIP.has(tag)) continue;

      if (BLOCKS.has(tag)) {
        // ブロックに入る前と出た後で切る。入れ子でも境目がずれない。
        flush();
        walk(child);
        flush();
      } else {
        // span や a のような行内の要素は、切らずにそのまま続ける。
        walk(child);
      }
    }
  };

  if (document.body) walk(document.body);
  flush();

  return blocks.join('\n\n');
}
