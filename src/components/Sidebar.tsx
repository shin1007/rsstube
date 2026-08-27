import Link from "next/link";
import type { FeedRow, FolderRow, View } from "@/lib/types";
import { VIEW_LABELS } from "@/lib/types";

/**
 * フォルダとフィードの一覧。PCでのみ表示する（スマホは下部タブで代替）。
 */

/** 下端に常駐する画面への導線。フィードとは別の見た目にしてある（下の注記）。 */
const NAV = [
  { href: '/listen', label: '聴く' },
  { href: '/library', label: 'アーカイブを検索' },
  { href: '/exports', label: '書き出し・朝のダイジェスト' },
  { href: '/settings', label: '設定・フィード管理' },
];
export function Sidebar({
  folders,
  feeds,
  unread,
  view,
  folderId,
  feedId,
  sort,
  active = true,
}: {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Map<string, number>;
  view: View;
  folderId?: string;
  feedId?: string;
  /** 並び順は絞り込みを変えても保つ。フォルダを移るたびに戻ると使いにくい。 */
  sort?: string;
  /**
   * いま一覧を見ているか。設定などの二次画面では false にして、どこも
   * 選択中にしない。false にしないと、設定を開いている間ずっと「未読」が
   * 光ったままになり、どこにいるのか分からなくなる。
   */
  active?: boolean;
}) {
  const feedsByFolder = new Map<string, FeedRow[]>();
  for (const feed of feeds) {
    const key = feed.folder_id ?? "";
    if (!feedsByFolder.has(key)) feedsByFolder.set(key, []);
    feedsByFolder.get(key)!.push(feed);
  }

  const folderUnread = (id: string) =>
    (feedsByFolder.get(id) ?? []).reduce(
      (sum, f) => sum + (unread.get(f.id) ?? 0),
      0,
    );

  /**
   * 未読ビューでは、未読ゼロのフォルダとフィードを出さない。
   *
   * 毎朝ここで見たいのは「今日どこに何が来たか」で、空の行はその邪魔にしかならない。
   * **他のビューでは畳まない。**「すべて」「スター」「あとで」で未読の数を根拠に
   * 隠すと、読み終わったフィードが一覧から消えて**開く手段が無くなる**
   * （検索したい・過去を見たいときに辿れない）。
   *
   * いま選んでいるフォルダ／フィードは、ゼロでも残す。開いている最中に
   * 最後の1件を読むと、自分がいる行だけが消えることになる。
   */
  const hideEmpty = active && view === 'unread';

  const visibleFeeds = (folderKey: string) => {
    const list = feedsByFolder.get(folderKey) ?? [];
    if (!hideEmpty) return list;
    return list.filter((f) => (unread.get(f.id) ?? 0) > 0 || f.id === feedId);
  };

  const visibleFolders = folders.filter(
    (f) => !hideEmpty || folderUnread(f.id) > 0 || f.id === folderId,
  );

  const link = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (sort && sort !== "new") sp.set("sort", sort);
    const qs = sp.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    // スクロールするのは真ん中だけ。以前は nav 全体を overflow-y-auto にしていたので、
    // mt-auto の下端リンク（設定など）がフィードの下に埋もれ、18本ぶんスクロールしないと
    // 辿り着けなかった。見出しと下端リンクは常に見えている必要がある。
    <nav className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-zinc-800 min-h-0">
      <div className="shrink-0 p-3 border-b border-zinc-800">
        <Link href="/" className="font-bold">
          RSSTube
        </Link>
      </div>

      {/* ここだけがスクロールする。 */}
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll">
        <div className="p-2 space-y-0.5">
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <Link
              key={v}
              href={link({ view: v })}
              className={`block rounded px-2 py-1.5 text-sm ${
                active && view === v && !folderId && !feedId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              {VIEW_LABELS[v]}
            </Link>
          ))}
        </div>

        <div className="p-2 space-y-2 border-t border-zinc-800">
          {visibleFolders.map((folder) => {
            const count = folderUnread(folder.id);
            return (
              <div key={folder.id}>
                <Link
                  href={link({ view, folder: folder.id })}
                  className={`flex items-center justify-between rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                    folderId === folder.id
                      ? "text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <span className="truncate">{folder.name}</span>
                  {count > 0 && (
                    <span className="ml-2 shrink-0 text-zinc-500">{count}</span>
                  )}
                </Link>

                <div className="mt-0.5">
                  {visibleFeeds(folder.id).map((feed) => (
                    <FeedLink
                      key={feed.id}
                      feed={feed}
                      href={link({ view, feed: feed.id })}
                      active={feedId === feed.id}
                      count={unread.get(feed.id) ?? 0}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* フォルダに入っていないフィード。 */}
          {visibleFeeds("").length > 0 && (
            <div>
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                未分類
              </p>
              {visibleFeeds("").map((feed) => (
                <FeedLink
                  key={feed.id}
                  feed={feed}
                  href={link({ view, feed: feed.id })}
                  active={feedId === feed.id}
                  count={unread.get(feed.id) ?? 0}
                />
              ))}
            </div>
          )}

          {/* 全部畳まれたときに、何も無い枠だけを見せない。
              フィードを消してしまったのかと読めるので、そうではないと書く。 */}
          {hideEmpty && visibleFolders.length === 0 && visibleFeeds("").length === 0 && (
            <p className="px-2 py-1 text-xs text-zinc-600">
              未読のあるフィードはありません
            </p>
          )}
        </div>
      </div>

      {/*
        常に見えているところ。フィードが増えても埋もれない。

        **フィードと同じ見た目にしない。**ここは読むものではなく道具で、
        性質が違う。以前は上の一覧とまったく同じ `text-sm text-zinc-400` で、
        フィード名の続きにしか見えなかった。

        区別は3つ: 小さく（text-xs）、字間を広げ（tracking-wide）、
        少し太く（font-medium）。**色は落とさない**（フィードと同じ zinc-400）。
        小さくしたうえに暗くすると、先日の「設定が見つからない」を作り直すことになる。
        大きさと字面だけで十分に別物に見える。
        フィード名は「固有名詞の一覧」、こちらは「機能の名前」として読ませたい。
      */}
      <div className="shrink-0 border-t border-zinc-800 p-3 pt-2.5">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="block rounded px-1 py-1.5 text-xs font-medium tracking-wide text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function FeedLink({
  feed,
  href,
  active,
  count,
}: {
  feed: FeedRow;
  href: string;
  active: boolean;
  count: number;
}) {
  return (
    <Link
      href={href}
      title={feed.last_error ?? undefined}
      className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
      }`}
    >
      <span className="truncate">
        {/* 取得に失敗し続けているフィードは印を出す。 */}
        {feed.error_count > 2 && <span className="mr-1 text-amber-500">!</span>}
        {feed.title || feed.url}
      </span>
      {count > 0 && (
        <span className="ml-2 shrink-0 text-xs text-zinc-500">{count}</span>
      )}
    </Link>
  );
}
