/**
 * 記事の代表画像をどこから取るか。
 *
 * スライドは HTML/CSS で描く（plan.md §4）ので、絵は素材として別に要る。
 * 本文抽出のついでに og:image を控えておき、音声を作るときに1枚だけ使う。
 *
 * 取れないことのほうが多い前提で書く。取れなければスライドは文字だけになる
 * （それでも壊れて見えないよう、SlideView 側で成立する形にしてある）。
 */

/** 明らかに記事の絵ではないもの。1x1 の計測用ビーコンやロゴを掴むと画面が汚れるだけ。 */
const JUNK = /(1x1|pixel|spacer|blank|transparent|avatar|logo|badge|icon)[-_.]?/i;

/**
 * HTML の meta から代表画像を選ぶ。
 *
 * og:image → twitter:image → link[rel=image_src] の順。og:image はサイト側が
 * 「共有されるときに出したい絵」として置いたものなので、本文中の最初の画像より
 * 当たりが良い（本文の1枚目は著者アイコンや広告のことがある）。
 */
export function pickImageFromDocument(
  document: { querySelector: (s: string) => { getAttribute: (a: string) => string | null } | null },
  baseUrl: string,
): string | null {
  const candidates = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]',
  ];

  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const raw = el.getAttribute('content') ?? el.getAttribute('href');
    const url = absolute(raw, baseUrl);
    if (url) return url;
  }

  return null;
}

/**
 * RSS の項目から代表画像を選ぶ。
 *
 * 本文が取れないサイト（403 が9件、docs/site-compat.md）でも、フィードには
 * enclosure が付いていることがある。抽出の成否と別の経路にしておく。
 */
export function pickImageFromRss(
  item: {
    enclosure?: { url?: string; type?: string };
    contentHtml?: string;
  },
  baseUrl: string,
): string | null {
  const enclosure = item.enclosure;
  if (enclosure?.url && (!enclosure.type || enclosure.type.startsWith('image/'))) {
    const url = absolute(enclosure.url, baseUrl);
    if (url) return url;
  }

  // 本文HTMLの最初の <img>。enclosure が無いフィード向けの最後の手段。
  const m = item.contentHtml?.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? absolute(m[1], baseUrl) : null;
}

/**
 * 相対URLを解決し、使えないものを落とす。
 *
 * data: を弾くのは、Storage へ写す前提に合わないため（巨大な base64 が
 * DB に入るだけで、絵として持ってくる意味が無い）。
 */
function absolute(raw: string | null | undefined, baseUrl: string): string | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (JUNK.test(url.pathname)) return null;

  return url.toString();
}

/**
 * 記事のページを取りに行って og:image を読む。
 *
 * 取り込みのときに拾えなかった記事のための後追い。**巡回では使わない。**
 * 音声を作るときに、表紙が要る1件だけを取りに行く用（lib/media/jobs.ts）。
 * 全記事ぶんを後から浚うと、2000件ぶん他所のサイトを叩くことになる。
 *
 * 本文抽出（extractArticle）を使い回さないのは、あちらが Readability も
 * 消毒も走らせるため。ここで欲しいのは head の1行だけ。
 */
export async function fetchImageUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // UA は正直に名乗る。偽装しても弾かれるところは弾かれる（CLAUDE.md）。
        'User-Agent': 'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;

    // head さえ読めればよい。全部読むと長い記事で無駄が大きい。
    const html = (await res.text()).slice(0, 200_000);
    const { parseHTML } = await import('linkedom');
    return pickImageFromDocument(parseHTML(html).document, url);
  } catch {
    // 403 もタイムアウトも珍しくない。表紙が無いだけなので黙って諦める。
    return null;
  }
}
