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

  const [{ data: folders }, { data: feeds }, articles, counts, selected] = await Promise.all([
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
    supabase
      .from('feeds')
      .select('id, title, url, site_url, folder_id, error_count, last_error, last_fetched_at')
      .order('title'),
    listArticles({ view, folderId, feedId, sort, search }),
    unreadCounts(),
    selectedId ? getArticle(selectedId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex-1 flex min-h-0">
      <Sidebar
        folders={(folders ?? []) as FolderRow[]}
        feeds={(feeds ?? []) as FeedRow[]}
        unread={counts}
        view={view}
        folderId={folderId}
        feedId={feedId}
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
        <ArticleView article={selected} />
      </div>

      <BottomTabs view={view} hidden={Boolean(selectedId)} />
    </div>
  );
}
