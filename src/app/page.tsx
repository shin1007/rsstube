import { listSubscribedFeeds } from '@/lib/subscriptions';
import { ArticleList } from '@/components/ArticleList';
import { ArticleView } from '@/components/ArticleView';
import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
import { getArticle, listArticles, unreadCounts } from '@/lib/articles';
import { createClient } from '@/lib/supabase/server';
import type { FeedRow, FolderRow, View } from '@/lib/types';

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

  const [{ data: folders }, feeds, articles, counts, selected] = await Promise.all([
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
    listSubscribedFeeds(),
    listArticles({ view, folderId, feedId, sort, search }),
    unreadCounts(),
    selectedId ? getArticle(selectedId) : Promise.resolve(null),
  ]);

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

  const index = selectedId ? articles.findIndex((a) => a.id === selectedId) : -1;
  const prev = index > 0 ? articles[index - 1] : undefined;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : undefined;

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
          prevHref={prev ? linkTo(prev.id) : undefined}
          nextHref={next ? linkTo(next.id) : undefined}
        />
      </div>

      <BottomTabs view={view} hidden={Boolean(selectedId)} />
    </div>
  );
}
