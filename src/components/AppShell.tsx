import { listSubscribedFeeds } from '@/lib/subscriptions';
import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
import { unreadCounts } from '@/lib/articles';
import { unplayedMediaCount } from '@/lib/media/list';
import { createClient } from '@/lib/supabase/server';
import type { FeedRow, FolderRow } from '@/lib/types';

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
export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const [{ data: folders }, feeds, counts, unplayed] = await Promise.all([
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
    listSubscribedFeeds(),
    unreadCounts(),
    unplayedMediaCount(),
  ]);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/*
        二次画面なので、どのビューも「開いている」状態にはしない。
        view に unread を渡しているが folderId/feedId が無いので、
        リンク先だけが正しく組み上がり、選択の強調は出ない……のではなく
        出てしまうため、あえて一覧側と同じ扱いにはしない。
      */}
      <Sidebar
        folders={(folders ?? []) as FolderRow[]}
        feeds={(feeds ?? []) as FeedRow[]}
        unread={counts}
        unplayed={unplayed}
        view="unread"
        active={false}
      />

      {children}

      {/* 二次画面では記事を開いていないので、常に出す。 */}
      <BottomTabs view="unread" hidden={false} unplayed={unplayed} />
    </div>
  );
}
