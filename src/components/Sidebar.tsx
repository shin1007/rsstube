import Link from "next/link";
import type { FeedRow, FolderRow, View } from "@/lib/types";
import { VIEW_LABELS } from "@/lib/types";

/**
 * フォルダとフィードの一覧。PCでのみ表示する（スマホは下部タブおよびドロワーで代替）。
 */

/** 下端に常駐する画面への導線。フィードとは別の見た目にしてある（下の注記）。 */
const NAV = [
  { href: '/listen', label: '聴く' },
  { href: '/library', label: 'アーカイブを検索' },
  { href: '/exports', label: '書き出し・朝のダイジェスト' },
  { href: '/settings', label: '設定・フィード管理' },
];

export function SidebarContent({
  folders,
  feeds,
  unread,
  view,
  folderId,
  feedId,
  unplayed = 0,
  active = true,
  onNavigate,
}: {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Map<string, number>;
  view: View;
  folderId?: string;
  feedId?: string;
  unplayed?: number;
  active?: boolean;
  onNavigate?: () => void;
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
   * 購読しているフィードが1本も無いフォルダは出さない。
   *
   * フォルダは購読より先に作れるし、最後の1本を解除しても残る。空のまま出すと
   * 見出しだけの行になり、押しても記事がゼロの一覧が開く（押す意味が無い）。
   *
   * **未読の数では隠さない。** 読み終わったことを根拠に消すと、あとで検索したい・
   * 過去を見たいときにそのフィードへ辿り着けなくなる（「すべて」で開く手段が
   * サイドバーしか無い）。ここで見ているのは「登録があるか」だけ。
   *
   * いま選んでいるフォルダは、空でも残す。最後の1本を解除した直後に
   * 自分が居る行だけが消えることになるので。
   *
   * **設定画面のフォルダ一覧は別。**あちらは管理する場所なので、空のフォルダも
   * 出す（出さないと消せない）。
   */
  const visibleFolders = folders.filter(
    (f) => (feedsByFolder.get(f.id) ?? []).length > 0 || f.id === folderId,
  );

  const link = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <>
      <div className="shrink-0 p-3 border-b border-zinc-800">
        <Link href="/" onClick={onNavigate} className="font-bold">
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
              onClick={onNavigate}
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
                  onClick={onNavigate}
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
                      onClick={onNavigate}
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
                  onClick={onNavigate}
                  active={feedId === feed.id}
                  count={unread.get(feed.id) ?? 0}
                />
              ))}
            </div>
          )}

          {/* 1本も購読していないときに、枠だけを見せない。
              フォルダを隠したせいで空に見えるのか、本当に何も無いのかを分ける。 */}
          {feeds.length === 0 && (
            <p className="px-2 py-1 text-xs text-zinc-600">
              購読中のフィードがありません（
              <Link href="/settings" onClick={onNavigate} className="underline hover:text-zinc-400">
                設定
              </Link>
              から追加できます）
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
            onClick={onNavigate}
            className="flex items-center rounded px-1 py-1.5 text-xs font-medium tracking-wide text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <span>{label}</span>
            {href === '/listen' && unplayed > 0 && (
              <span
                className="ml-2 shrink-0 rounded-full bg-amber-600 px-1.5 text-[11px] leading-4 text-zinc-950"
                aria-label={`未視聴 ${unplayed}件`}
              >
                {unplayed}
              </span>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}

export function Sidebar(props: {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Map<string, number>;
  view: View;
  folderId?: string;
  feedId?: string;
  unplayed?: number;
  active?: boolean;
}) {
  return (
    <nav className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-zinc-800 min-h-0">
      <SidebarContent {...props} />
    </nav>
  );
}

function FeedLink({
  feed,
  href,
  active,
  count,
  onClick,
}: {
  feed: FeedRow;
  href: string;
  active: boolean;
  count: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
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

