/**
 * Readability が「ページの枠」を本文として掴んでしまったときの立て直し。
 *
 * Readability は候補の中から一番点の高い節を本文とみなすが、**本文が短い記事では
 * グローバルメニューのほうが点で勝つ**。日本語のページで特に起きやすい:
 * 点数は文字数と読点（`,`）の数から出すのに、日本語の読点は `、` なので数えられず、
 * リンクだらけのメニューが「長いテキスト」として残る。
 *
 * 実例（厚労省 `stf/newpage_75898.html`）。本文は250字ほどの記者会見の案内で、
 * 返ってきたのは `<div id="top">` ——ヘッダーのメガメニューを含むページ丸ごとの
 * 2006字だった。**100字を超えているので「抽出成功」に見え**、
 * `feed_content_stats()` にも出ない。読む人には「中身が無い」としか見えない。
 *
 * 直し方は、疑わしいときだけ `<main>` の中に閉じ込めてもう一度掴ませること。
 * 枠を掴んだかどうかは**返ってきたHTMLに `<header>` / `<nav>` / `<footer>` が
 * 残っているか**で見る。Readability はこれらを本文の外側とみなして落とすので、
 * 残っているのは「枠ごと本文にした」ときだけ。
 */

type MinimalDocument = {
  querySelector(selector: string): { innerHTML: string } | null;
};

/**
 * 枠を丸ごと掴んだ疑いがあるか。
 *
 * 疑うだけなら安い（`<main>` が無ければ何も起きないし、掴み直しはメモリの中だけ）。
 * 本文がちゃんと取れているページでは、この3つのタグは Readability が落としている。
 */
export function looksLikeFrame(content: string): boolean {
  return /<(header|nav|footer)[\s/>]/i.test(content);
}

/**
 * 本文が入っているはずの範囲。`<main>` か `role="main"` だけを見る。
 *
 * **Readability に渡す前に控えること。** Readability は渡された document を
 * 書き換える（節を削り、属性を落とす）ので、掴んだあとに querySelector しても
 * 元の中身はもう残っていない。
 *
 * `<article>` は見ない。一覧ページでは記事1件ぶんのカードにも付いていて、
 * 拾うと関係のない記事が本文になる。
 */
export function mainRegionHtml(document: MinimalDocument): string | null {
  const main = document.querySelector('main') ?? document.querySelector('[role="main"]');
  if (!main) return null;
  const html = main.innerHTML;
  return html.trim() ? html : null;
}
