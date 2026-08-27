import { listSubscribedFeeds } from '@/lib/subscriptions';
import { ArticleList } from '@/components/ArticleList';
import { ArticleView } from '@/components/ArticleView';
import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
import { getArticle, listArticleIds, listArticles, unreadCounts } from '@/lib/articles';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, type FeedRow, type FolderRow, type View } from '@/lib/types';

/**
 * リーダー本体。
 *
 * PC: フォルダ / 記事リスト / 本文 の三ペイン。
 * スマホ: 単カラム。記事を選んでいるときは本文だけを全画面で出し、
 *         それ以外はリストを出す。下部にタブを置く。
 */

export const dynamic = 'force-dynamic';

const VIEWS: View[] = ['unread', 'starred', 'later', 'all', 'unsummarized'];

export default async function ReaderPage({ searchParams }: PageProps<'/'>) {
  const params = await searchParams;

  const view = (VIEWS as string[]).includes(String(params.view))
    ? (params.view as View)
    : 'unread';
  const sort = params.sort === 'important' ? 'important' : 'new';
  const folderId = typeof params.folder === 'string' ? params.folder : undefined;
  const feedId = typeof params.feed === 'string' ? params.feed : undefined;
  const search = typeof params.q === 'string' && params.q.trim() ? params.q.trim() : undefined;
  const selectedId = typeof params.article === 'string' ? params.article : undefined;

  const supabase = await createClient();

  const [{ data: folders }, feeds, articles, counts, picked] = await Promise.all([
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
    listSubscribedFeeds(),
    listArticles({ view, folderId, feedId, sort, search }),
    unreadCounts(),
    selectedId ? getArticle(selectedId) : Promise.resolve(null),
  ]);

  /**
   * 何も選んでいないときは先頭の記事を出す。
   *
   * 以前は「記事を選択してください」という空の枠だった。開いた直後に読むものが
   * 出ていないと、必ず1回クリックしてからでないと始められない。
   *
   * **これも既読にする**（2026-08-18 に方針変更）。以前は「表示しているだけ」として
   * 既読にしなかったが、目の前に本文が出ているのに未読のまま残るほうが不自然だった。
   * 既読を付けるのは components/MarkReadOnView。
   *
   * ここで付けないのは、**スマホでは記事ペインが `hidden md:block` で消えているだけ**
   * だから。サーバー側では見えているかどうかが分からず、素直に付けると一覧を
   * 眺めているだけの人の先頭記事が黙って既読になる。実際に交差したかを
   * ブラウザに聞く必要がある。
   *
   * スマホには波及しない。記事ペインは `article` が無いと `hidden md:block` で
   * 隠れるので、スマホでは今までどおり一覧が出る。
   *
   * 一覧を取ってからでないと先頭が分からないので、この1回だけ往復が増える。
   * 東京に寄せたあとなので10ms程度。
   */
  const previewId = selectedId ?? articles[0]?.id;
  const selected = selectedId ? picked : previewId ? await getArticle(previewId) : null;

  // 記事を開いていても、戻り先と前後の記事は「今の絞り込み」を保った URL にする。
  // ここを / にしてしまうと、フォルダや検索を選んだ状態が戻るたびに消える。
  const linkTo = (articleId?: string) => {
    const sp = new URLSearchParams();
    if (view !== 'unread') sp.set('view', view);
    if (sort !== 'new') sp.set('sort', sort);
    if (folderId) sp.set('folder', folderId);
    if (feedId) sp.set('feed', feedId);
    if (search) sp.set('q', search);
    if (articleId) sp.set('article', articleId);
    const qs = sp.toString();
    return qs ? `/?${qs}` : '/';
  };

  // 前後の記事は「いま出しているもの」を基準にする。先頭を自動で出したときも
  // 「次へ」で読み進められるように。
  const index = previewId ? articles.findIndex((a) => a.id === previewId) : -1;
  let prevId = index > 0 ? articles[index - 1].id : undefined;
  let nextId = index >= 0 && index < articles.length - 1 ? articles[index + 1].id : undefined;

  /**
   * 無限スクロールで先へ進んでから開いた記事は、1ページ目には入っていない。
   * そのまま index = -1 のまま描くと**「次の記事」がどこにも出ない**——スマホには
   * 一覧へ戻る以外の導線が無いので、61件目から先は毎回戻ることになる。
   * そのときだけ id だけを広く引いて位置を出す。
   *
   * 未読ビューでは引かない。**開いた記事はその場で既読になる**ので、
   * 未読の一覧には最初から居ない（1ページ目に無いのは深いからではない）。
   * 引いても必ず空振りで、記事を開くたびに1往復ぶん無駄になる。
   * 1ページ目が埋まっていないときも引かない——続きが無いので深いはずがない。
   */
  if (previewId && index === -1 && view !== 'unread' && articles.length >= PAGE_SIZE) {
    const ids = await listArticleIds({ view, folderId, feedId, sort, search });
    const at = ids.indexOf(previewId);
    if (at >= 0) {
      prevId = at > 0 ? ids[at - 1] : undefined;
      nextId = at < ids.length - 1 ? ids[at + 1] : undefined;
    }
  }

  return (
    // 高さの確定は layout.tsx の body（h-dvh）が持つ。ここに h-dvh を足しても
    // flex-basis が height に勝つので効かない（実測で確認済み）。
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <Sidebar
        folders={(folders ?? []) as FolderRow[]}
        feeds={(feeds ?? []) as FeedRow[]}
        unread={counts}
        view={view}
        folderId={folderId}
        feedId={feedId}
        sort={sort}
      />

      {/* 記事リスト。スマホでは記事を選んでいる間は隠す。 */}
      <div
        className={`w-full md:w-96 md:shrink-0 border-r border-zinc-800 min-h-0 ${
          selectedId ? 'hidden md:block' : 'block'
        }`}
      >
        <ArticleList
          articles={articles}
          view={view}
          sort={sort}
          selectedId={selectedId}
          search={search}
        />
      </div>

      {/* 本文。スマホでは記事を選んだときだけ出す。 */}
      <div className={`flex-1 min-w-0 min-h-0 ${selectedId ? 'block' : 'hidden md:block'}`}>
        <ArticleView
          article={selected}
          backHref={linkTo()}
          prevHref={prevId ? linkTo(prevId) : undefined}
          nextHref={nextId ? linkTo(nextId) : undefined}
        />
      </div>

      <BottomTabs view={view} hidden={Boolean(selectedId)} />
    </div>
  );
}
