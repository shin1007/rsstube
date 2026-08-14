import Parser from 'rss-parser';
import { decodeBody } from '@/lib/feeds/charset';
import { isRedirect, MAX_HOPS, permanentTarget } from '@/lib/feeds/redirect';

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
  | { status: 'not-modified'; movedTo?: string }
  | {
      status: 'ok';
      title: string;
      siteUrl?: string;
      etag?: string;
      lastModified?: string;
      items: FetchedItem[];
      /**
       * 恒久的な移転先（301/308 で辿り着いた場合だけ）。
       * 呼び出し側が feeds.url を書き換える判断に使う。
       */
      movedTo?: string;
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

  // リダイレクトは自分で追う。fetch に任せると読めはするが、
  // 「恒久的に移転した」ことが分からず、古いURLを叩き続けることになる。
  let current = url;
  const hops: { status: number; to: string }[] = [];
  let res: Response;

  for (let i = 0; ; i++) {
    res = await fetch(current, {
      headers,
      redirect: 'manual',
      // フィードはこちらで巡回間隔を管理するので、Next.js 側のキャッシュは挟まない。
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });

    if (!isRedirect(res.status)) break;

    const location = res.headers.get('location');
    if (!location) break; // 行き先が無いリダイレクトは追いようがない。
    if (i >= MAX_HOPS) throw new Error(`リダイレクトが多すぎます（${MAX_HOPS}回）`);

    // 相対で書かれていることがあるので、いまのURLで解決する。
    const next = new URL(location, current).toString();
    hops.push({ status: res.status, to: next });
    current = next;
  }

  const movedTo = permanentTarget(hops) ?? undefined;

  if (res.status === 304) return { status: 'not-modified', movedTo };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  // フィードも UTF-8 とは限らない。日本語のサイトには Shift_JIS / EUC-JP が残っていて、
  // XML 宣言の encoding にだけ書かれていることがある（本文抽出と同じ事情）。
  const xml = decodeBody(res.headers.get('content-type'), new Uint8Array(await res.arrayBuffer()));
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
    movedTo,
  };
}
