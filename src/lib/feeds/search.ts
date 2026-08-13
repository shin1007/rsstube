import { inspectFeed, type FeedCandidate } from '@/lib/feeds/discover';

/**
 * 名前やキーワードでフィードを探す。
 *
 * URL が手元に無いときのための入口。「ナゾロジー」「東洋経済」のように
 * 名前で打てたほうが速いし、そもそもサイトのURLを思い出せないこともある。
 *
 * Feedly の公開検索を借りている。自前で索引を持つのは現実的でないし、
 * 購読者数という「まともなフィードかどうか」の目安まで付いてくる。
 *
 * 借り物なので次の前提で組んである:
 *   - 落ちても登録そのものは URL 経由でできる（この検索は付加機能）
 *   - 打った語は Feedly に送られる。個人用なので許容するが、そのことは画面に出す
 *
 * 索引には死んだフィードが混じる（実測で3件に1件ほど、404 や記事0件）。
 * 出したものが登録できないのは体験として悪いので、上位だけ並行で読みに行って
 * 生きているものに絞る。ついでに最新記事も取れるので、URL から探したときと
 * 同じように中身を見せられる。
 */

const ENDPOINT = 'https://cloud.feedly.com/v3/search/feeds';

/** 一度に出す件数。多すぎると選べない。 */
const COUNT = 8;

/** 購読者がこれ未満のものは出さない。個人の実験用フィードや死んだものが混じるため。 */
const MIN_SUBSCRIBERS = 3;

/**
 * 生きているか確かめるのに待つ時間。
 * 全部の応答を待つと、1本の遅いフィードに引きずられて検索全体が10秒を超えた。
 */
const VERIFY_BUDGET_MS = 5_000;

type FeedlyResult = {
  feedId?: string;
  title?: string;
  website?: string;
  subscribers?: number;
  description?: string;
};

/**
 * 打たれたものが URL（かドメイン）に見えるか。
 *
 * 見えるなら discoverFeeds に回し、そうでなければ名前で検索する。
 * 日本語の名前には普通ドットが入らないので、これで概ね分かれる。
 */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // 空白が入っていれば名前。「Quanta Magazine」を URL とみなさない。
  if (/\s/.test(s)) return false;
  // example.com のような形。最後のドットの後ろが2文字以上の英字。
  return /^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(s);
}

export async function searchFeeds(query: string): Promise<FeedCandidate[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `${ENDPOINT}?query=${encodeURIComponent(q)}&count=${COUNT}`;

  let json: { results?: FeedlyResult[] };
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    json = await res.json();
  } catch {
    throw new Error('検索できませんでした。フィードかサイトのURLを貼ってみてください');
  }

  const hits = (json.results ?? [])
    // feedId は "feed/https://example.com/feed" の形で来る。
    .map((r) => ({ ...r, url: (r.feedId ?? '').replace(/^feed\//, '') }))
    .filter((r) => /^https?:\/\//i.test(r.url))
    .filter((r) => (r.subscribers ?? 0) >= MIN_SUBSCRIBERS)
    .slice(0, COUNT);

  // 上位を並行で読みに行く。1本ずつ順に見ると人が待てる時間に収まらない。
  //
  // 「読めなかった」と「まだ返ってこない」は分けて扱う。前者は死んでいるので捨てるが、
  // 後者は単に遅いだけかもしれないので、中身を出せないまま候補には残す。
  // 全部の応答を待つと、1本の遅いフィードに引きずられて10秒を超えることがあった。
  const checked = await Promise.all(
    hits.map(async (r) => {
      const live = await Promise.race([
        inspectFeed(r.url),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), VERIFY_BUDGET_MS)),
      ]);

      if (live === null) return null; // 確かに読めなかった
      if (live === 'timeout') {
        return {
          url: r.url,
          title: r.title || r.url,
          siteUrl: r.website,
          subscribers: r.subscribers,
          itemCount: 0,
          sampleTitles: [],
        } satisfies FeedCandidate;
      }

      // 表題は検索側のほうが整っていることが多いので、あればそちらを使う。
      return {
        ...live,
        title: r.title || live.title,
        siteUrl: r.website ?? live.siteUrl,
        subscribers: r.subscribers,
      } satisfies FeedCandidate;
    }),
  );

  const alive: FeedCandidate[] = [];
  for (const c of checked) if (c) alive.push(c);
  if (alive.length > 0) return alive;

  // 全部読めなかったときは、検索の結果そのものを出す。こちらの取得が
  // 弾かれているだけかもしれないので、登録を試す道は残す（登録時にもう一度確かめる）。
  return hits.map((r) => ({
    url: r.url,
    title: r.title || r.url,
    siteUrl: r.website,
    subscribers: r.subscribers,
    itemCount: 0,
    sampleTitles: r.description ? [r.description.slice(0, 80)] : [],
  }));
}
