/**
 * 「このページは入口で、本体は別にある」を見つける。
 *
 * 官公庁・自治体の記事にはこの形が多い。表題とリンクだけのHTMLがあって、
 * 中身はPDF（厚労省の「○○の動向」など）か、別ページに置かれている。
 * HTMLだけを読むと本文が100字に満たず「取得失敗」に落ちるが、
 * 落ちているのは**取り方**であって、中身は普通に公開されている。
 *
 * ただし**間違った先を本文にすると、静かに嘘の要約ができる**。
 * 「本文が取れなかった」は見れば分かるが、「関連記事の本文がこの記事として
 * 要約されている」は読んでも気づけない。なので判定は臆病に倒す:
 *
 *   - 追うのは1段だけ。追った先からさらに追わない（巡回にしない）
 *   - PDFがあればPDFを本体とみなす（添付ではなく本体である場合がほとんど）
 *   - HTMLを追うのは「入口にしか見えないページ」だけ。候補が多いページは
 *     一覧・目次なので**何も追わない**
 *   - 追った先が短ければ諦めて、今までどおり RSS の抜粋に任せる
 */

export type Followup = {
  url: string;
  kind: 'pdf' | 'html';
  /** リンクの文字。画面に「本体はこれ」と出すときの見出しに使う。 */
  label: string;
};

type MinimalElement = {
  tagName: string;
  id?: string;
  className?: unknown;
  parentElement: MinimalElement | null;
  getAttribute(name: string): string | null;
  textContent: string | null;
};

type MinimalDocument = {
  querySelectorAll(selector: string): Iterable<MinimalElement>;
  querySelector(selector: string): { textContent: string | null } | null;
};

/** ここより下にあるリンクは、記事ではなく画面の枠。 */
const CHROME_TAGS = new Set(['HEADER', 'FOOTER', 'NAV', 'ASIDE']);

/**
 * 枠だと分かる id / class。実データ（厚労省）で数えたら、1ページ48本のリンクのうち
 * 44本がここに当たり、残ったのが本体のPDFと Excel だった。
 */
const CHROME_ID_CLASS =
  /nav|menu|header|footer|breadcrumb|pankuzu|topicpath|topic-path|sidebar|side_?menu|banner|share|social|skip|global|copyright|pagetop|page-top|logo|plugin|tool|search/i;

/** 読めない添付。リンクとしては本体でも、こちらには開けない。 */
const UNREADABLE = /\.(xlsx?|docx?|pptx?|zip|lzh|tar|gz|csv|rtf|jpe?g|png|gif|webp|mp[34]|mov|wav)$/i;

/** 本体とみなすPDFの数。審議会の資料のように何本もぶら下がることがある。 */
const MAX_PDF = 3;

/**
 * 会議の手続き書類。中身が無いので、これで枠を使い切らせない。
 *
 * 審議会のページは資料が10本以上ぶら下がり、**先頭は必ず議事次第と委員名簿**。
 * 順番どおりに3本取ると、読めるのは「会議の次第と出席者」だけになる。
 * ここに挙げたものは後回しにして、資料そのものを先に読む。
 */
const PROCEDURAL = /議事次第|^次第|委員名簿|構成員名簿|出席者|座席表|開催要綱|開催案内/;

/**
 * HTMLを追ってよい候補の上限。
 *
 * ここを超えるページは「入口」ではなく一覧（新着記事の目次など）。
 * 一覧から1本選んで本文にすると、**関係のない記事が本文として保存される**ので、
 * 迷ったら何も追わない。
 */
const MAX_HTML = 3;

export function pickFollowups(
  document: MinimalDocument,
  pageUrl: string,
  /** ページの見出し。リンク文字と照らして「本体らしさ」を見る。 */
  title?: string,
): Followup[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const pdfs: Followup[] = [];
  const pages: Followup[] = [];
  const seen = new Set<string>([key(base)]);

  for (const anchor of document.querySelectorAll('a[href]')) {
    if (inChrome(anchor)) continue;

    const href = anchor.getAttribute('href');
    const url = absolute(href, base);
    if (!url) continue;

    const id = key(url);
    if (seen.has(id)) continue;

    const label = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();

    if (/\.pdf$/i.test(url.pathname)) {
      seen.add(id);
      pdfs.push({ url: url.toString(), kind: 'pdf', label });
      continue;
    }

    if (UNREADABLE.test(url.pathname)) continue;
    // 節の入口（`…/` や `…/index.html`）は本体ではない。実例: 千葉県の
    // 「協議会の開催について」から同じ階層の index.html を本体として読み、
    // **その回の開催案内ではなく協議会そのものの説明**が本文になっていた。
    // 一段上の説明は、どの記事にも同じくらい「それらしく」当たってしまう。
    if (/(^|\/)(index\.html?|index\.php)?$/i.test(url.pathname)) continue;
    // 別サイトは追わない。リンク先が第三者のページなら、それはもう別の記事。
    if (url.host !== base.host) continue;
    // 文字の無いリンク（画像だけ・記号だけ）は枠の残り。
    if (!/[\p{L}\p{N}]/u.test(label)) continue;
    if (!looksLikeBody(url, base, label, title)) continue;

    seen.add(id);
    pages.push({ url: url.toString(), kind: 'html', label });
  }

  // PDFがあるなら、それが本体。ここで打ち切ってHTMLは見ない。
  if (pdfs.length > 0) {
    // 並びは変えるが、落としはしない（手続き書類しか無いページもある）。
    const body = pdfs.filter((p) => !PROCEDURAL.test(p.label));
    const procedural = pdfs.filter((p) => PROCEDURAL.test(p.label));
    return [...body, ...procedural].slice(0, MAX_PDF);
  }
  if (pages.length === 0 || pages.length > MAX_HTML) return [];
  return pages;
}

/**
 * 「本体らしいリンク」だけを通す。どちらか一方でよい。
 *
 *   1. このページと同じ場所か、その下にある（入口とその中身は隣に置かれる）
 *   2. リンクの文字がページの見出しと重なっている（「○○について」→「○○について（詳細）」）
 *
 * どちらも無いリンクは、たいてい関連記事や案内。追わない。
 */
function looksLikeBody(url: URL, base: URL, label: string, title?: string): boolean {
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  if (url.pathname.startsWith(dir)) return true;

  const heading = normalizeTitle(title);
  const text = normalizeTitle(label);
  if (heading.length >= 6 && text.length >= 6) {
    if (heading.includes(text) || text.includes(heading)) return true;
  }
  return false;
}

/** 見出しの比較用。サイト名の付け足しや記号のゆれを落とす。 */
function normalizeTitle(value?: string): string {
  if (!value) return '';
  return value
    .split(/[|｜]/)[0]
    .replace(/[\s　]+/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .trim();
}

/**
 * 画面の枠の中にあるリンクか。
 *
 * **body と html は見ない。** 厚労省は `<body class="t-mhlw nav03">` のように
 * ページの種類を body の class に書いていて、これを枠の印として数えると
 * **そのページのリンクが1本残らず枠扱いになる**（実際にこれで、PDFが
 * 目の前にあるのに1本も候補に上がらなかった。「候補ゼロ」は静かなので、
 * 動いていないことに気づけない）。
 */
function inChrome(element: MinimalElement): boolean {
  let node: MinimalElement | null = element;
  while (node && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
    if (CHROME_TAGS.has(node.tagName)) return true;
    const marks = `${node.id ?? ''} ${typeof node.className === 'string' ? node.className : ''}`;
    if (marks.trim() && CHROME_ID_CLASS.test(marks)) return true;
    node = node.parentElement;
  }
  return false;
}

function absolute(href: string | null, base: URL): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** 同じページかどうかは # を落として見る（#contents は自分自身へのリンク）。 */
function key(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}
