import Link from "next/link";
import type { FeedRow, FolderRow, View } from "@/lib/types";
import { VIEW_LABELS } from "@/lib/types";

/**
 * フォルダとフィードの一覧。PCでのみ表示する（スマホは下部タブで代替）。
 */
export function Sidebar({
  folders,
  feeds,
  unread,
  view,
  folderId,
  feedId,
  sort,
}: {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Map<string, number>;
  view: View;
  folderId?: string;
  feedId?: string;
  /** 並び順は絞り込みを変えても保つ。フォルダを移るたびに戻ると使いにくい。 */
  sort?: string;
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
                view === v && !folderId && !feedId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              {VIEW_LABELS[v]}
            </Link>
          ))}
        </div>

        <div className="p-2 space-y-2 border-t border-zinc-800">
          {folders.map((folder) => {
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
                  {(feedsByFolder.get(folder.id) ?? []).map((feed) => (
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
          {(feedsByFolder.get("") ?? []).length > 0 && (
            <div>
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                未分類
              </p>
              {(feedsByFolder.get("") ?? []).map((feed) => (
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
        </div>
      </div>

      {/* 常に見えているところ。フィードが増えても埋もれない。 */}
      <div className="shrink-0 p-3 border-t border-zinc-800 space-y-1.5">
        <Link
          href="/listen"
          className="block text-sm text-zinc-400 hover:text-zinc-100"
        >
          聴く
        </Link>
        <Link
          href="/library"
          className="block text-sm text-zinc-400 hover:text-zinc-100"
        >
          アーカイブを検索
        </Link>
        <Link
          href="/exports"
          className="block text-sm text-zinc-400 hover:text-zinc-100"
        >
          書き出し・朝のダイジェスト
        </Link>
        <Link
          href="/settings"
          className="block text-sm text-zinc-400 hover:text-zinc-100"
        >
          設定・フィード管理
        </Link>
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
