import { listSubscribedFeeds } from '@/lib/subscriptions';
import { ArticleList } from '@/components/ArticleList';
import { ArticleView } from '@/components/ArticleView';
import { AppBadge } from '@/components/AppBadge';
import { BottomTabs } from '@/components/BottomTabs';
import { Sidebar } from '@/components/Sidebar';
import { countArticles, getArticle, listArticleIds, listArticles, unreadCounts } from '@/lib/articles';
import { unplayedMediaCount } from '@/lib/media/list';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, asId, type FeedRow, type FolderRow, type View } from '@/lib/types';

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
  // URL から来る id は形を見てから使う。形が違うだけでページ全体が500に
  // なっていた（lib/types.ts の asId）。
  const folderId = asId(params.folder);
  const feedId = asId(params.feed);
  const search = typeof params.q === 'string' && params.q.trim() ? params.q.trim() : undefined;
  const selectedId = asId(params.article);

  const supabase = await createClient();

  /**
   * **検索だけは、失敗してもページごと落とさない。**
   *
   * 検索語は URL のクエリに3回並べて PostgREST へ渡すので、こちらの都合の
   * 外で失敗しうる——長すぎれば接続が切れるし、`drop table` のような並びは
   * Supabase の手前の WAF に HTML のブロックページを返されて、supabase-js が
   * 解釈できずに落ちる（実測。技術系のフィードを読む人なら普通に打つ語）。
   *
   * ここで落とすと**検索欄を直す場所ごと消える**ので、一覧を空にして
   * 「検索できなかった」と出すほうに倒す。検索していないときの失敗は
   * こちらの不具合なので、そのまま投げる（黙って空の一覧を出さない）。
   */
  const searchable = async <T,>(run: () => Promise<T>, fallback: T): Promise<[T, boolean]> => {
    try {
      return [await run(), false];
    } catch (e) {
      if (!search) throw e;
      return [fallback, true];
    }
  };

  const [{ data: folders }, feeds, [articles, searchFailed], counts, unplayed, picked, [total]] =
    await Promise.all([
      supabase.from('folders').select('id, name').order('sort_order').order('name'),
      listSubscribedFeeds(),
      searchable(() => listArticles({ view, folderId, feedId, search }), []),
      unreadCounts(),
      unplayedMediaCount(),
      selectedId ? getArticle(selectedId) : Promise.resolve(null),
      // 「あと何件」を出すためだけの数。**並べて投げること**——直列にすると
      // そのぶんが画面遷移の待ち時間にまるごと乗る（docs/traps/perf.md）。
      searchable(() => countArticles({ view, folderId, feedId, search }), null),
    ] as const);

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
  /**
   * **見つからない記事を指していたら、選んでいない扱いに戻す。**
   *
   * `?article=` は URL に出ているので、古いブックマーク・打ち間違い・
   * 保持期間を過ぎて消えた記事を指したリンクが普通に来る。ここで戻さないと、
   * スマホでは一覧が `hidden` のままで**何も出ない画面**になる
   * （PC は一覧が横にあるので気づけるが、スマホには出口が無い）。
   */
  const openId = selectedId && picked ? selectedId : undefined;

  const previewId = openId ?? articles[0]?.id;
  const selected = openId ? picked : previewId ? await getArticle(previewId) : null;

  // 記事を開いていても、戻り先と前後の記事は「今の絞り込み」を保った URL にする。
  // ここを / にしてしまうと、フォルダや検索を選んだ状態が戻るたびに消える。
  const linkTo = (articleId?: string) => {
    const sp = new URLSearchParams();
    if (view !== 'unread') sp.set('view', view);
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
   * いま開いている記事より後ろに何件あるか。**「まだ続くのか」を出すため。**
   *
   * 位置が出せないときは undefined のままにする（0 にしない）。0 は
   * 「ここで終わり」という別の意味を持っていて、分からないことと同じではない。
   */
  let remaining: number | undefined =
    total !== null && index >= 0 ? Math.max(0, total - 1 - index) : undefined;

  /**
   * 一覧の**最後の1件**を開いているときは、その先があるかどうかが分からない。
   *
   * ここで見ている `articles` は1ページぶん（PAGE_SIZE = 60）しかない。60件目を
   * 開くと `index === articles.length - 1` になって「次は無い」と出てしまい、
   * **ちょうど60件目で読み進められなくなる**（下のボタンも ← → も止まる）。
   * 実測で確認済み——「すべて」ビューで → を押し続けると、毎回60件目で止まった。
   * 一覧を下までスクロールすれば61件目以降は継ぎ足されるのに、前後の行き先だけは
   * サーバーの1ページ目しか見ていなかった。
   *
   * ちょうど60件で終わっている一覧は「ここが終わり」なのか「続きがある」のかを
   * 区別できないので、そのときだけ id しか運ばない一覧を引き直す。
   * 60件に満たなければ本当の終わりなので、引き直さない。
   */
  const atPageEnd = index >= 0 && index === articles.length - 1 && articles.length >= PAGE_SIZE;

  /**
   * 一覧に居ない記事を開いたときは、位置を引き直す。
   *
   * そのまま index = -1 で描くと**前後の帯そのものが出ない**（下の nav は
   * prevHref も nextHref も無いときは描かれない）。スマホには一覧へ戻る以外の
   * 導線が無いので、そこで読み進める手が完全に無くなる。
   *
   * 一覧に居ない理由は2つあって、**どちらも未読ビューで起きる**:
   *
   *   1. 無限スクロールで先へ進んでから開いた（61件目から先は1ページ目に無い）
   *   2. **開いた拍子に既読になった。** 既読を書くのと本文を描くのは同時に走るので、
   *      書き込みが先に着くと、この描画の一覧からはもう抜けている
   *
   * 以前は「未読ビューでは引いても空振り」として丸ごと飛ばしていた。2 が
   * 起きているときはそのとおりだが、**その結果が「前後のボタンが消える」だった**
   * ——一覧の1本目を開いた瞬間から、スマホでは次の記事へ行けなくなっていた。
   * id で見つからなければ日付で「居たはずの場所」を出す。
   */
  if (previewId && (index === -1 || atPageEnd) && !searchFailed) {
    const [slots] = await searchable(
      () => listArticleIds({ view, folderId, feedId, search }),
      [] as Awaited<ReturnType<typeof listArticleIds>>,
    );
    const at = slots.findIndex((s) => s.id === previewId);

    if (at >= 0) {
      prevId = at > 0 ? slots[at - 1].id : undefined;
      nextId = at < slots.length - 1 ? slots[at + 1].id : undefined;
      if (total !== null) remaining = Math.max(0, total - 1 - at);
    } else if (selected?.published_at) {
      // 並びは新しい順。自分より古い最初の記事が「次」、その1つ手前が「前」。
      const when = selected.published_at;
      const older = slots.findIndex((s) => !s.published_at || s.published_at < when);
      if (older >= 0) {
        prevId = older > 0 ? slots[older - 1].id : undefined;
        nextId = slots[older].id;
        // 自分は一覧から抜けている（未読ビューで既読になった）ので、
        // older から後ろが「まだ読んでいないぶん」そのもの。1を引かない。
        if (total !== null) remaining = Math.max(0, total - older);
      } else if (slots.length > 0) {
        // 自分がいちばん古い。前だけ出す。
        prevId = slots[slots.length - 1].id;
      }
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
        unplayed={unplayed}
        view={view}
        folderId={folderId}
        feedId={feedId}
      />

      {/* 記事リスト。スマホでは記事を選んでいる間は隠す。 */}
      <div
        className={`w-full md:w-96 md:shrink-0 border-r border-zinc-800 min-h-0 ${
          openId ? 'hidden md:block' : 'block'
        }`}
      >
        <ArticleList
          articles={articles}
          view={view}
          selectedId={openId}
          search={search}
          searchFailed={searchFailed}
          folders={(folders ?? []) as FolderRow[]}
          feeds={(feeds ?? []) as FeedRow[]}
          unread={counts}
          unplayed={unplayed}
          folderId={folderId}
          feedId={feedId}
          // ← → で前後の記事へ移るためだけに渡す。下のボタンと同じ行き先を使う
          // ——一覧から数え直すと、開いた記事が一覧に居ないときに動かなくなる。
          prevHref={prevId ? linkTo(prevId) : undefined}
          nextHref={nextId ? linkTo(nextId) : undefined}
        />
      </div>

      {/* 本文。スマホでは記事を選んだときだけ出す。 */}
      <div className={`flex-1 min-w-0 min-h-0 ${openId ? 'block' : 'hidden md:block'}`}>
        <ArticleView
          article={selected}
          backHref={linkTo()}
          prevHref={prevId ? linkTo(prevId) : undefined}
          nextHref={nextId ? linkTo(nextId) : undefined}
          remaining={remaining}
        />
      </div>

      {/* ホーム画面のアイコンに未読の数を出す。サイドバーと同じ値。 */}
      <AppBadge count={[...counts.values()].reduce((sum, n) => sum + n, 0)} />

      <BottomTabs view={view} hidden={Boolean(openId)} unplayed={unplayed} />
    </div>
  );
}
