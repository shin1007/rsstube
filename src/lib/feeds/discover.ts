import { fetchFeed } from '@/lib/feeds/parse';

/**
 * サイトのURLからフィードを見つける。
 *
 * これまでは「フィードのURLを正確に知っていること」が登録の前提だった。
 * ふつうは記事を読んでいるページのURLしか手元に無いので、そのまま貼ると失敗する。
 * ここで次の順に探す:
 *
 *   1. 貼られたURL自体がフィードならそれを使う
 *   2. HTML の <link rel="alternate" type="application/rss+xml"> を拾う
 *   3. よくある場所（/feed, /rss.xml など）を順に叩く
 *
 * 2 で足りることが多いが、link タグを置いていないサイトもあるので 3 を残してある。
 */

export type FeedCandidate = {
  url: string;
  title: string;
  siteUrl?: string;
  /** 見つかった記事数と、最新の数件。登録前に「これで合っているか」を目で見るため。 */
  itemCount: number;
  sampleTitles: string[];
  /**
   * 購読者数。名前で検索したときだけ付く（Feedly が返す）。
   * 「まともなフィードかどうか」の目安になる。
   */
  subscribers?: number;
};

const USER_AGENT = 'RSSTube/0.1 (personal feed reader)';

/** link タグが無いサイト向けの当てずっぽう。多い順に並べてある。 */
const COMMON_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

/** 当てずっぽうで叩く数の上限。全部叩くと遅いうえ、相手にも失礼。 */
const MAX_GUESSES = 4;

/** 候補として返す最大数。 */
const MAX_CANDIDATES = 5;

/**
 * 入力を URL にする。
 * スキーマ無しで貼られることが多い（`nazology.kusuguru.co.jp` など）ので補う。
 */
export function normalizeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 既にスキーマが書かれている場合は、http(s) 以外を足で補わない。
  // 「先頭が http:// でなければ https:// を足す」だけにすると、
  // file:///etc/passwd が https://file///etc/passwd に化けて、
  // サーバーがそれを取りに行くことになる。
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * HTML から フィードへのリンクを抜き出す。
 *
 * 正規表現で済ませているのは、ここで欲しいのが head の link タグだけで、
 * DOM を組む必要が無いため（本文抽出のように構造を辿るわけではない）。
 * 属性の順序は決まっていないので、rel と type と href を別々に拾う。
 */
export function extractFeedLinks(html: string, baseUrl: string): string[] {
  const found: string[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1] ?? '';
    const type = /\btype\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1] ?? '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];

    if (!href) continue;
    if (!/alternate/i.test(rel)) continue;
    if (!/(rss|atom)\+xml|application\/xml|text\/xml/i.test(type)) continue;

    try {
      // 相対パスで書かれていることが多いので、ページのURLで解決する。
      const resolved = new URL(href, baseUrl).toString();
      if (!found.includes(resolved)) found.push(resolved);
    } catch {
      // 壊れた href は黙って飛ばす。
    }
  }

  return found;
}

/** 見つけたフィードを、中身を1回読んで候補にする。読めなければ null。 */
export async function inspectFeed(url: string): Promise<FeedCandidate | null> {
  try {
    const result = await fetchFeed(url);
    if (result.status !== 'ok' || result.items.length === 0) return null;

    return {
      url,
      title: result.title || url,
      siteUrl: result.siteUrl,
      itemCount: result.items.length,
      sampleTitles: result.items.slice(0, 3).map((i) => i.title).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export async function discoverFeeds(input: string): Promise<FeedCandidate[]> {
  const url = normalizeInput(input);
  if (!url) throw new Error('URL として読めません');

  // 1. 貼られたものがそのままフィードか。
  const direct = await inspectFeed(url);
  if (direct) return [direct];

  // 2. ページの中の link タグ。
  let html = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) html = await res.text();
  } catch {
    // 取れなければ 3 に進む。
  }

  const links = extractFeedLinks(html, url);
  const found: FeedCandidate[] = [];

  for (const link of links.slice(0, MAX_CANDIDATES)) {
    const candidate = await inspectFeed(link);
    if (candidate) found.push(candidate);
  }
  if (found.length > 0) return found;

  // 3. よくある場所を当てる。link タグを置いていないサイト向け。
  const origin = new URL(url).origin;
  for (const path of COMMON_PATHS.slice(0, MAX_GUESSES)) {
    const candidate = await inspectFeed(`${origin}${path}`);
    if (candidate) return [candidate];
  }

  throw new Error('フィードが見つかりませんでした。フィードのURLを直接貼ってみてください');
}
