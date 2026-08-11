import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

/**
 * 記事本文の抽出。
 *
 * RSS には抜粋しか入っていないことが多く、抜粋だけを要約させても
 * 「抜粋の言い換え」にしかならない。記事URLを取りに行って本文を抜く。
 * サイトによっては取れない（JS描画・ペイウォール・403）ので、
 * 失敗は想定内として扱い、呼び出し側でRSSの内容にフォールバックする。
 */

export type ExtractResult = {
  text: string;
  /** true = 本文抽出に成功。false = 取れなかった。 */
  ok: boolean;
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)';

/** 要約に渡す上限。長すぎる記事は先頭を優先して切る。 */
const MAX_CHARS = 40_000;

export async function extractArticle(url: string): Promise<ExtractResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html')) {
    throw new Error(`HTMLではない (${contentType})`);
  }

  const html = await res.text();
  // JSDOM にリソースを取りに行かせない（画像やスクリプトを読み込むと遅く不安定になる）。
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  const text = (article?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();

  // 極端に短い結果は抽出失敗とみなす（同意画面やエラーページを掴んでいることが多い）。
  if (text.length < 200) {
    return { text, ok: false };
  }

  return { text: text.slice(0, MAX_CHARS), ok: true };
}

/** HTMLタグを落として素のテキストにする。RSS本文のフォールバック用。 */
export function htmlToText(html: string): string {
  return new JSDOM(`<body>${html}</body>`).window.document.body.textContent
    ?.replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS) ?? '';
}
