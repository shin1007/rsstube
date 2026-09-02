import { createClient } from '@/lib/supabase/server';
import { subscribedFeedIds } from '@/lib/subscriptions';
import { sanitizeSearch } from '@/lib/search';
import { PAGE_SIZE, asId, type ArticleRow, type View } from '@/lib/types';

/**
 * 一覧用の記事取得。
 *
 * 記事・要約・状態を1クエリで取る。Supabase の埋め込み選択を使うので
 * N+1 にはならない。並び順は「新着順」か「重要度順」。
 *
 * 記事とフィードは全ユーザー共通なので（0005）、「自分の記事」を切り出しているのは
 * article_states!inner のほう。状態行は購読時と巡回時にしか作られないため、
 * これが購読フィルタを兼ねる。フォルダは購読ごとの持ち物なので subscriptions を見る。
 */

export type ArticleQuery = {
  view: View;
  folderId?: string;
  feedId?: string;
  sort: 'new' | 'important';
  search?: string;
  /**
   * 何件目から返すか。無限スクロールの継ぎ足しで使う。
   *
   * 未読ビューでは読んだ記事が一覧から抜けるので、**続きを取っている間に
   * 位置がずれる**（既読にしたぶんだけ後ろが繰り上がる）。ここでは直さない。
   * 受け取る側が id で重複を落とすこと。DB 側で位置を凍らせようとすると
   * カーソル用の一意な列が要るが、重要度順は同点が並ぶので一意にならない。
   */
  offset?: number;
};

type RawRow = {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  excerpt: string | null;
  extracted_at: string | null;
  created_at: string | null;
  feeds: { id: string; title: string; subscriptions?: unknown } | null;
  summaries: { bullets: string[]; importance: number; title_ja: string | null } | null;
  article_states: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

/**
 * **購読しているフィードだけに絞るのは `feed_id in (…)` で行う。**
 *
 * 記事とフィードは全ユーザー共通なので（0005）、購読していないフィードの記事も
 * 表には残っている。以前はそれを `feeds!inner (subscriptions!inner (folder_id))` の
 * 入れ子で落としていた——正しいのだが、**その入れ子ひとつで未読一覧が7倍遅かった**
 * （本番相当のデータで 227ms → 31ms）。埋め込みは1つ増えるごとに横結合が増え、
 * Supabase の無料枠では計画だけで数十msかかる（EXPLAIN で計画44ms・実行61ms）。
 * 購読は12本しかないので、id を先に引いて集合で絞るほうが圧倒的に速い。
 *
 * `article_states!inner` のほうは残す。あれは「自分の記事」を切り出すためのもので
 * （状態行は購読時と巡回時にしか作られない）、購読の絞り込みとは別の仕事をしている。
 */
/**
 * **問い合わせの組み立て役を async にしないこと。**
 *
 * supabase-js の builder は thenable なので、`async` 関数から返すと
 * その `await` が builder を実行してしまう（返るのは組み立て途中の builder
 * ではなく**結果**になる）。`.order()` が無いと型検査で言われて気づいたが、
 * 型が緩い書き方をしていたら、そのまま並べ替えの無い問い合わせが走っていた。
 * 非同期に要るもの（購読の id）だけを先に取り、当てるのは同期でやる。
 */
async function subscribedIdsFor(query: ArticleQuery): Promise<string[]> {
  const subs = await subscribedFeedIds();
  return query.folderId
    ? subs.filter((s) => s.folder_id === query.folderId).map((s) => s.feed_id)
    : subs.map((s) => s.feed_id);
}

/**
 * 一覧に出すぶん。**行に出していない列は取らない。**
 *
 * 記事は `?article=` の付け替えで開くので、1回開くたびにこの一覧が
 * まるごと運び直される（実測61KB / 24行）。`url` `author` `content_ok`
 * `tags` は行のどこにも出していないのに、そのぶんが遷移のたびに乗っていた。
 * 元記事のリンクも書き手も、開いた先（getArticle）が持っている。
 */
const LIST_SELECT = `id, title, url, published_at, excerpt, extracted_at, created_at,
   feeds!inner (id, title),
   summaries (bullets, importance, title_ja),
   article_states!inner (is_read, is_starred, read_later, exported_at)`;

/**
 * 前後の記事を出すためだけの、id しか要らないぶん。件数を数えるのにも使う。
 *
 * 埋め込みを落とせないのは、絞り込み（未読・スター・フォルダ）が
 * 埋め込んだ表の列を見るため。!inner が無いと条件そのものが書けない。
 * 運ぶ列は id だけなので、本文も要約も付いてこない。
 *
 * **`summaries` も埋めておくこと。** 「要約なし」ビューの条件が
 * `.is('summaries', null)` で、埋め込んでいないと PostgREST が
 * `column articles.summaries does not exist` で落ちる。しかも
 * `head: true`（件数だけ数える形）だと本文が返らないぶん**メッセージが空の
 * エラー**になり、画面には `Error: {"message":""}` の500だけが出る
 * ——どの問い合わせが落ちたのか手掛かりが無い。
 * `!inner` にはしないこと。要約が無い記事こそがこのビューの中身なので、
 * 内部結合にすると1件も残らない。
 */
const ID_SELECT = `id, published_at,
   summaries (importance),
   article_states!inner (is_read, is_starred, read_later)`;

/**
 * 絞り込みだけを当てる。**一覧と件数で条件がずれないように1か所にまとめる。**
 * ずれると「あと12件」と出しておきながら3件目で終わる、という形で表に出る。
 */
function applyFilters<T>(q: T, query: ArticleQuery): T {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let b = q as any;

  // フォルダの絞り込みは scopeToSubscribed が feed_id の集合として当てる。
  if (query.feedId) b = b.eq('feed_id', query.feedId);

  switch (query.view) {
    case 'unread':
      b = b.eq('article_states.is_read', false);
      break;
    case 'starred':
      b = b.eq('article_states.is_starred', true);
      break;
    case 'later':
      b = b.eq('article_states.read_later', true);
      break;
    case 'unsummarized':
      // ワーカーは要約が返らなかった記事もジョブを完了扱いにする（無料枠を
      // 食い潰さないため）。落ちたぶんはここでしか見つけられない。
      //
      // ただし「まだ本文を取りに行っていない記事」は、要約が無くて当たり前で、
      // 待てば付く。混ぜると順番待ちの山に埋もれて、本当に落ちたものが見えなくなる
      // （実際に95件の順番待ちがあった）。処理済みのものだけを出す（0014）。
      b = b.is('summaries', null).not('extracted_at', 'is', null);
      break;
    case 'all':
      break;
  }

  if (query.search) {
    // 日本語は形態素解析が無いので、タイトルと本文の部分一致で引く。
    // 検索語をそのまま埋めるとカンマや括弧で or 式が壊れるので落としておく。
    const term = sanitizeSearch(query.search);
    // 訳した見出しも対象にする。一覧に出しているのはそちらなので、原題だけだと
    // 「見えている語で検索して当たらない」ことになる（0024 の複製を引く）。
    if (term) {
      b = b.or(`title.ilike.%${term}%,title_ja.ilike.%${term}%,content_text.ilike.%${term}%`);
    }
  }

  return b as T;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 絞り込みと並び順は1か所にまとめる。一覧と id 取得で条件がずれると、
 * 「前後の記事」だけ別の並びを指すことになり、押すたびに飛ぶ先が変わる。
 *
 * select を変数で渡しているので supabase-js の型推論は効かない。
 * 呼び出し側が形を知っているので、そちらで受け直すこと。
 */
async function run(select: string, query: ArticleQuery, limit: number) {
  const supabase = await createClient();

  // 購読しているフィードだけに絞る。空の in は「1件も無い」で、
  // 購読ゼロやフォルダが空のときの正しい答えになる。
  const feedIds = await subscribedIdsFor(query);

  let q = applyFilters(
    supabase
      .from('articles')
      .select(select)
      .in('feed_id', feedIds)
      .range(query.offset ?? 0, (query.offset ?? 0) + limit - 1),
    query,
  );

  /**
   * **最後に id で並べること（同着の決着）。**
   *
   * articles.importance は summaries.importance の複製（0007）。埋め込んだ
   * summaries 側を order しても親の記事順は変わらないので、並べ替えは必ず
   * articles 側の列で行う。要約がまだ無い記事は null になり末尾に回る。
   *
   * そして日時だけでは順番が決まらない。実データで**243件が同じ日時**を持ち
   * （45組、最大18件が同時刻。自治体や省庁は同じ時刻でまとめて出す）、
   * その中の並びは Postgres の気分次第になる。決まらないと2つ壊れる:
   *   - **無限スクロールで記事が重複・欠落する。** offset で継ぎ足すので、
   *     同着の組が60件の境目をまたぐと、2ページ目に同じ記事が出たり抜けたりする
   *   - **「次の記事」が戻ったり飛んだりする。** 前後は毎回この並びから数え直す
   * 実行計画が変われば並びも変わるので、いま安定して見えるのは偶然。
   */
  if (query.sort === 'important') {
    q = q
      .order('importance', { ascending: false, nullsFirst: false })
      .order('published_at', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('published_at', { ascending: false, nullsFirst: false });
  }
  q = q.order('id', { ascending: false });

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listArticles(query: ArticleQuery): Promise<ArticleRow[]> {
  const data = await run(LIST_SELECT, query, PAGE_SIZE);

  return (data as unknown as RawRow[]).map((r) => {
    // 行は先頭3つしか出さない。4つ目から先は運ぶだけ無駄になる。
    const bullets = r.summaries?.bullets?.slice(0, 3) ?? [];

    return {
      id: r.id,
      title: r.title,
      // 行には出さないが、`v`（元記事を開く）が使う。**消さないこと**
      // ——消したときは window.open(undefined) になって about:blank が開いた。
      url: r.url,
      published_at: r.published_at,
      /**
       * **要点があるときは抜粋を運ばない。** 行に出るのはどちらか片方で、
       * 要点があればそちらが勝つ（ArticleList の Row）。抜粋は日本語で
       * 150字ほどあり、1行あたりでいちばん重い列なのに、ほとんどの行では
       * 一度も表示されない。
       */
      excerpt: bullets.length > 0 ? null : r.excerpt,
      extracted_at: r.extracted_at,
      created_at: r.created_at,
      feed: r.feeds ? { id: r.feeds.id, title: r.feeds.title } : null,
      summary: r.summaries ? { ...r.summaries, bullets } : null,
      state: r.article_states ?? null,
    };
  });
}

/**
 * 前後の記事を出すための id 一覧。
 *
 * 無限スクロールで先へ進んでから開いた記事は1ページ目に入っていないので、
 * 一覧の配列からは位置が出せない。かといって記事を60件ずつ何度も取り直すのは
 * 高い（本文も要約も付いてくる）。ここは id しか運ばない。
 *
 * 上限を切ってあるのは、一覧の無限スクロールと同じ理由。ここより深いところの
 * 前後は出ない（出せないぶんはリンクを出さない。押せないボタンは出さない）。
 */
const NEIGHBOUR_SCAN = 600;

/**
 * 日付も一緒に返すのは、**一覧に居ない記事の位置を出すため**。
 * 未読ビューで開いた記事はその場で既読になるので、次に一覧を引いたときには
 * もう居ない。id では引っかからないが、日付なら「居たはずの場所」が分かる。
 */
/**
 * いまの絞り込みに何件あるか。**「あと何件」を出すためだけのもの。**
 *
 * 行は1件も運ばない（`head: true`）ので、返ってくるのは数だけ。
 * 一覧の取得とは**並行して**投げること（page.tsx の Promise.all）。
 * 直列にすると、そのぶんがまるごと画面遷移の待ち時間に乗る。
 *
 * 以前ここを数えなかったのは「未読ビューでは読むそばから変わるから」だった。
 * 変わるのはそのとおりだが、**読み手が知りたいのは正確な在庫ではなく
 * 「まだ続くのか、もう終わりか」**で、1件ずれても用は足りる。
 * 数が無いほうが困る——終わりが見えないまま押し続けることになる。
 */
export async function countArticles(query: ArticleQuery): Promise<number | null> {
  const supabase = await createClient();
  const feedIds = await subscribedIdsFor(query);

  const { count, error } = await applyFilters(
    supabase
      .from('articles')
      .select(ID_SELECT, { count: 'exact', head: true })
      .in('feed_id', feedIds),
    query,
  );
  if (error) throw error;
  return count;
}

export type ArticleSlot = { id: string; published_at: string | null };

export async function listArticleIds(query: ArticleQuery): Promise<ArticleSlot[]> {
  const data = await run(ID_SELECT, { ...query, offset: 0 }, NEIGHBOUR_SCAN);
  return (data as unknown as ArticleSlot[]).map((r) => ({
    id: r.id,
    published_at: r.published_at,
  }));
}

export async function getArticle(id: string) {
  // 形が違う id は「無い記事」と同じ扱い（lib/types.ts の asId を参照）。
  if (!asId(id)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select(
      `id, title, url, author, published_at, excerpt, content_text, content_html, content_ok, extracted_at, extract_fail, created_at,
       feeds (id, title),
       summaries (bullets, tags, importance, title_ja),
       article_states (is_read, is_starred, read_later, exported_at)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * サイドバーに出す未読件数。フィード単位で集計する（呼び出し側でフォルダにまとめる）。
 *
 * 数えるのは DB 側（0020 の `unread_counts()`）。以前は未読の記事を最大5000行
 * 取ってきて JS で数えていたが、実測で1171行が返っていた。欲しいのは18個の
 * 数字だけなので、その65倍を毎回運んでいたことになる。
 * しかもこれは全ページで呼ばれる（AppShell が持つため）ので、常時かかる。
 */
export async function unreadCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('unread_counts');

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { feed_id: string; unread: number }[]) {
    counts.set(row.feed_id, Number(row.unread));
  }
  return counts;
}
