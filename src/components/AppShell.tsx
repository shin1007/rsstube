import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
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
 *
 * 要るものは `shellData()` が**1往復で**返す。以前はここで4本を並べて
 * 投げていたが、全ページで通るところなので往復ぶんが常時かかっていた。
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const { folders, feeds, unread, unplayed } = await shellData();

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/*
        二次画面なので、どのビューも「開いている」状態にはしない。
        view に unread を渡しているが folderId/feedId が無いので、
        リンク先だけが正しく組み上がり、選択の強調は出ない……のではなく
        出てしまうため、あえて一覧側と同じ扱いにはしない。
      */}
      <Sidebar
        folders={folders}
        feeds={feeds}
        unread={unread}
        unplayed={unplayed}
        view="unread"
        active={false}
      />

      {children}

      {/* 二次画面では記事を開いていないので、常に出す。 */}
      <BottomTabs hidden={false} unplayed={unplayed} />
    </div>
  );
}
