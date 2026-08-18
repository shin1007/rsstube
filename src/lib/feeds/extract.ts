import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlToText as buildText } from '@/lib/feeds/text';
import { decodeBody } from '@/lib/feeds/charset';
import { sanitizeHtml } from '@/lib/feeds/sanitize';
import { pickImageFromDocument } from '@/lib/feeds/image';

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
  /**
   * 消毒済みの本文HTML。画面に出すのはこちら（lib/feeds/sanitize.ts）。
   * 要約と検索はテキストのほうを使う（マークアップは AI に何も足さない）。
   */
  html: string;
  /** true = 本文抽出に成功。false = 取れなかった。 */
  ok: boolean;
  /**
   * 記事の代表画像（og:image）。スライドの表紙に使う。
   * 本文が短すぎて ok=false のときも、絵だけは使えるので返す。
   */
  imageUrl: string | null;
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)';

/** 要約に渡す上限。長すぎる記事は先頭を優先して切る。 */
const MAX_CHARS = 40_000;

/**
 * 保存するHTMLの上限。タグのぶんテキストより嵩むので広めに取るが、
 * 無制限にすると DB（無料枠500MB）を一気に食う。
 */
const MAX_HTML_CHARS = 120_000;

/**
 * これ未満なら「本文を取れなかった」とみなす境目。
 *
 * 短い記事は実在する。アメブロのように、動画を紹介するだけの300字程度の投稿は
 * 珍しくない。一方で、ここを下げすぎると本文でないものを本文として拾う。
 *
 * 実データ（抽出に失敗している44件）で100〜200字の帯を調べたところ、中身は
 * はっきり2種類に割れた:
 *
 *   東洋経済など  写真キャプション＋著者プロフィール（ペイウォールで本文が出ない）。
 *                 RSS の抜粋のほうが本物のリード文で、明らかに良い
 *   Hacker News   ナビゲーションや変更履歴。ただし RSS 抜粋が
 *                 `<a href=…>Comments</a>` だけなので、これでもマシ
 *
 * つまりこの帯は当たり外れが混ざる。200 のままだと短い実記事を捨て、100 にすると
 * キャプションを拾う。**短い記事を拾えるほうを選んで 100 にしている**（本人の判断）。
 *
 * 要約の質が落ちたと感じたら、まずここを 200 に戻して様子を見ること。
 * どの記事が影響を受けているかは `npm run check:url -- <URL>` で確かめられる。
 */
const MIN_CONTENT_CHARS = 100;

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
  // Readability は meta を落とすので、掴む前の document から取る。
  const imageUrl = pickImageFromDocument(document, url);

  // textContent ではなく、Readability が整えた HTML から段落を組み立てる。
  // textContent はブロックの境目に何も入れないので段落が全部つながり、代わりに
  // 元HTMLの改行だけが残る。結果、見た目が書き手のHTMLの書き方に左右される
  // （改行だらけのサイトと、改行が1つも無いサイトができる）。lib/feeds/text.ts 参照。
  const text = htmlToText(article?.content ?? '');
  // 相対パスの画像やリンクを解決するため、記事のURLを渡す。
  const safeHtml = sanitizeHtml(article?.content ?? '', url);

  // 極端に短い結果は抽出失敗とみなし、RSS の抜粋に任せる
  // （同意画面・エラーページ・ナビゲーションを掴んでいることが多い）。
  if (text.length < MIN_CONTENT_CHARS) {
    return { text, html: '', ok: false, imageUrl };
  }

  return {
    text: text.slice(0, MAX_CHARS),
    html: safeHtml.slice(0, MAX_HTML_CHARS),
    ok: true,
    imageUrl,
  };
}

/**
 * HTMLタグを落として素のテキストにする。RSS本文のフォールバック用。
 * 段落の作り方は本文抽出と共有する（片方だけ読みやすい、という差を作らない）。
 */
export function htmlToText(html: string): string {
  return buildText(html).slice(0, MAX_CHARS);
}
