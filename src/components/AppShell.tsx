import { Suspense } from 'react';
import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
import { SidebarFallback } from '@/components/SidebarFallback';
import { shellData } from '@/lib/shell';

/**
 * 二次画面（設定・書き出し・アーカイブ・聴く）の外枠。
 *
 * これまで二次画面はサイドバーの無い単独ページだった。開くと一覧が消えるので、
 * 戻るには「← 一覧」を押すしかなく、**フォルダやフィードへ直接は戻れない**。
 * PCでは画面の左3分の1が丸ごと空くのも落ち着かない。読む場所と設定する場所は
 * 行き来するものなので、枠は残す。
 *
 * スマホでは今までどおりサイドバーは出ない（Sidebar が `hidden md:flex`）。
 * 代わりに下部タブを出して、二次画面からも他へ移れるようにする。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/*
        サイドバーは**セッションのもの**（フォルダ・購読・未読件数）なので、
        `shellData()` の `"use cache: private"` に乗って App Shell に入る
        ——押した瞬間に出る側。中身が来るまでの間だけ枠を出す。
      */}
      <Suspense fallback={<SidebarFallback />}>
        <ShellSidebar />
      </Suspense>

      {children}

      {/* 二次画面では記事を開いていないので、常に出す。 */}
      <Suspense fallback={null}>
        <ShellTabs />
      </Suspense>
    </div>
  );
}

async function ShellSidebar() {
  const { folders, feeds, unread, unplayed } = await shellData();
  return <Sidebar folders={folders} feeds={feeds} unread={unread} unplayed={unplayed} />;
}

async function ShellTabs() {
  const { unplayed } = await shellData();
  return <BottomTabs unplayed={unplayed} />;
}
