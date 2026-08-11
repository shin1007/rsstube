import Parser from 'rss-parser';

/**
 * フィードの取得と解析。
 *
 * ETag / Last-Modified による条件付きGETで、更新が無いフィードは
 * 304 で即座に切り上げる。個人用でもフィードが数百になると効いてくる。
 */

export type FetchedItem = {
  guid?: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  excerpt?: string;
  /** RSS本文（content:encoded など）。本文抽出に失敗したときのフォールバックに使う。 */
  contentHtml?: string;
};

export type FetchFeedResult =
  | { status: 'not-modified' }
  | {
      status: 'ok';
      title: string;
      siteUrl?: string;
      etag?: string;
      lastModified?: string;
      items: FetchedItem[];
    };

const parser = new Parser({
  customFields: { item: [['content:encoded', 'contentEncoded']] },
});

const USER_AGENT = 'RSSTube/0.1 (personal feed reader)';

export async function fetchFeed(
  url: string,
  conditional?: { etag?: string | null; lastModified?: string | null },
): Promise<FetchFeedResult> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
  if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    // フィードはこちらで巡回間隔を管理するので、Next.js 側のキャッシュは挟まない。
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 304) return { status: 'not-modified' };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const xml = await res.text();
  const parsed = await parser.parseString(xml);

  const items: FetchedItem[] = [];
  for (const item of parsed.items ?? []) {
    const link = item.link?.trim();
    if (!link) continue; // リンクが無い項目は開けないので取り込まない。

    const contentHtml =
      (item as { contentEncoded?: string }).contentEncoded ?? item.content ?? undefined;

    items.push({
      guid: item.guid ?? undefined,
      url: link,
      title: (item.title ?? '').trim() || link,
      author: item.creator ?? undefined,
      publishedAt: item.isoDate ?? undefined,
      excerpt: item.contentSnippet?.slice(0, 500) ?? undefined,
      contentHtml,
    });
  }

  return {
    status: 'ok',
    title: (parsed.title ?? '').trim(),
    siteUrl: parsed.link ?? undefined,
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
    items,
  };
}
