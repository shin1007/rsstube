import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { decodeBody } from '@/lib/feeds/charset';

/**
 * 記事本文の抽出。
 *
 * RSS には抜粋しか入っていないことが多く、抜粋だけを要約させても
 * 「抜粋の言い換え」にしかならない。記事URLを取りに行って本文を抜く。
 * サイトによっては取れない（JS描画・ペイウォール・403）ので、
 * 失敗は想定内として扱い、呼び出し側でRSSの内容にフォールバックする。
 *
 * DOM は jsdom ではなく linkedom を使う。jsdom@30 が引く html-encoding-sniffer は
 * CJS のまま ESM 専用の @exodus/bytes を require() していて、Vercel が jsdom を
 * 外部モジュールとして読み込む経路で ERR_REQUIRE_ESM になる。ローカルの dev では
 * ESM で解決されるので再現せず、本番で初めてワーカーが丸ごと落ちた。
 * linkedom は依存も軽く、サーバーレスのコールドスタートにも効く。
 * 差し替え時に実記事8件で比較し、抽出結果が完全に一致することを確認済み。
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

  // res.text() は Content-Type の charset しか見ず、無ければ UTF-8 として読む。
  // 日本の自治体・省庁には Shift_JIS / EUC-JP が現役で残っていて、しかも
  // charset を meta にだけ書いていることがある。そのまま読むと丸ごと文字化けし、
  // **長さはあるので抽出は成功に見えたまま**、化けた文字列が要約に回る。
  const html = decodeBody(res.headers.get('content-type'), new Uint8Array(await res.arrayBuffer()));
  // linkedom は外部リソースを取りに行かないので、画像やスクリプトで遅くならない。
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();

  const text = (article?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();

  // 極端に短い結果は抽出失敗とみなす（同意画面やエラーページを掴んでいることが多い）。
  if (text.length < 200) {
    return { text, ok: false };
  }

  return { text: text.slice(0, MAX_CHARS), ok: true };
}

/** HTMLタグを落として素のテキストにする。RSS本文のフォールバック用。 */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<body>${html}</body>`);
  return (
    document.body?.textContent?.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS) ?? ''
  );
}
