'use client';

import { useEffect } from 'react';
import { SidebarContent } from '@/components/Sidebar';
import type { FeedRow, FolderRow, View } from '@/lib/types';

/**
 * 一覧の周りに出る細かいもの（キーの見た目・ヘルプ・取り消しの帯・
 * スマホのドロワー）。**一覧本体（ArticleList）から切り出してある。**
 *
 * どれも「開いているあいだだけ」のもので、一覧の読み書きには関わらない。
 * 一緒に置いておくと、一覧を読むときに毎回この分量を跨ぐことになる。
 */

/**
 * ヘルプに出す一覧。実際の処理は ArticleList の onKey 側にあるので、
 * 増やしたら両方直すこと。
 */
export const SHORTCUTS: [string, string][] = [
  ['j / ↓', '一覧で次へ'],
  ['k / ↑', '一覧で前へ'],
  ['o / Enter', '開く'],
  ['→ / ←', '開いたまま次／前の記事へ'],
  ['Esc', '記事を閉じる'],
  ['m', '既読・未読'],
  ['s', 'スター'],
  ['l', 'あとで'],
  ['v', '元記事を新しいタブで開く'],
  ['Shift + A', '表示中をすべて既読'],
  ['Shift + M', 'ここから下（古い方）を既読'],
  ['r', 'いま取りに行く（更新）'],
  ['/', '検索'],
  ['?', 'このヘルプ'],
];

/**
 * 一覧の下端に常設するぶん。
 *
 * **ヘルプ（?）は、あることを知らないと開かれない。**元の作りではショートカットが
 * 全部その中に畳まれていて、`?` を押す動機がそもそも生まれなかった。よく使う数個
 * だけを常に見えるところへ置き、残りは `?` に畳む。全部を下端に出すと、毎日見る
 * 画面の下端が読みものになる。
 */
export const BAR: [string, string][] = [
  ['j/k', '移動'],
  ['o', '開く'],
  ['←/→', '前後'],
  ['m', '既読'],
  ['s', '★'],
  ['l', 'あとで'],
];

/** キーの見た目。文字だけだと本文に紛れて、押せる文字だと分からない。 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-px text-[13px] leading-none text-zinc-300">
      {children}
    </kbd>
  );
}

/**
 * 全既読の取り消し。自分から消える。
 *
 * 無限スクロールを入れてから、この対象は「読み込んだぶん全部」になった。
 * 1ページ目で頭打ちだった頃より押し間違いの被害が大きいので、消えるまでを
 * 10秒に伸ばしてある（8秒だと、件数を読んでから指を動かすには短い）。
 */
const UNDO_MS = 10000;

export function UndoBar({
  count,
  onUndo,
  onDismiss,
}: {
  count: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      // PC ではショートカットのバーぶん（約28px）上に置く。重ねると
      // 「取り消す」がバーの上に乗って、どちらも読めなくなる。
      className="absolute inset-x-3 bottom-20 z-20 flex items-center gap-3 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg md:bottom-12"
    >
      <span className="flex-1">{count}件を既読にしました</span>
      <button type="button" onClick={onUndo} className="font-semibold text-sky-400 hover:text-sky-300">
        取り消す
      </button>
      <button type="button" onClick={onDismiss} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-300">
        ✕
      </button>
    </div>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="キーボードショートカット"
      onClick={onClose}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded border border-zinc-700 bg-zinc-900 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">キーボードショートカット</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-baseline gap-3">
              <dt className="w-24 shrink-0 text-right">
                <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[14px] text-zinc-300">{keys}</kbd>
              </dt>
              <dd className="text-xs text-zinc-400">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-zinc-800 pt-3 text-[14px] text-zinc-500">
          一覧は下までスクロールすると続きを読み込みます。
        </p>
      </div>
    </div>
  );
}

/** スマホ用のフィード・フォルダ切り替えドロワー。中身はサイドバーと同じもの。 */
export function FeedDrawer({
  folders,
  feeds,
  unread,
  view,
  folderId,
  feedId,
  unplayed,
  onClose,
}: {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Map<string, number>;
  view: View;
  folderId?: string;
  feedId?: string;
  unplayed: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="フィード・フォルダ一覧"
    >
      {/* 背景の暗幕。タップで閉じる */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* ドロワー本体 */}
      <div className="relative w-72 max-w-[85vw] h-full bg-zinc-950 border-r border-zinc-800 flex flex-col z-10 shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/50">
          <span className="text-xs font-semibold text-zinc-300">フィード・フォルダ</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 active:scale-95 transition"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <SidebarContent
            folders={folders}
            feeds={feeds}
            unread={unread}
            view={view}
            folderId={folderId}
            feedId={feedId}
            unplayed={unplayed}
            onNavigate={onClose}
          />
        </div>
      </div>
    </div>
  );
}
