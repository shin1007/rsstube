/**
 * 一覧を1回に取る件数。無限スクロールはこの単位で継ぎ足す。
 *
 * types に置いてあるのは、クライアント側（ArticleList）にも同じ数が要るため。
 * lib/articles.ts に置いたままにすると、そこから next/headers を引いているので
 * クライアントコンポーネントにサーバ専用のコードが混ざる。
 *
 * **速さのために下げようとして、戻した**（2026-09-06。もう一度やらないこと）。
 *
 * 1ページ目は画面遷移のたびに丸ごと組み直される（記事は `?article=` の
 * 付け替えで開くため）ので、ここは「一度に何件読めるか」だけでなく
 * 「1タップごとに何件ぶん組み立てるか」でもある——という筋で 30 に下げた。
 * 結果は**運ぶ量だけ半分（RSC 92KB → 60KB）で、時間は 340ms → 350ms と
 * 動かなかった**。
 *
 * 見積もりの立て方が間違っていた。「60行ぶんで約96ms」は同じ run の中で
 * `/`（21KB・332ms）と `/?view=all`（92KB・428ms）を引き算した数字だが、
 * **その差は行数の差だけではない**（`?view=all` は未読の絞りが無いぶん
 * count も重い）。詳しくは docs/traps/perf.md。
 *
 * 速さの根拠が消えた以上、1ページ目は長いほうがよい（スクロールの継ぎ足しが
 * 減る）ので 60 に戻す。**次に下げたくなったら、まず同じ画面で片方だけ変えて
 * 測ること。**
 */
export const PAGE_SIZE = 60;

/**
 * 一覧の1行。**リーダーの一覧（/）と アーカイブ（/library）で運ぶ列が違う。**
 *
 * `?` が付いているのはアーカイブだけが使う列。リーダーの一覧は記事を開くたびに
 * 1ページぶんまるごと運び直すので（RSC のペイロードは実測61KB / 24行）、
 * **画面に出していない列を1つ足すと、その重さが全部の遷移に乗る**。
 * 出していないものは運ばないこと。
 */
export type ArticleRow = {
  id: string;
  title: string;
  /**
   * 元記事へのリンク。行には出していないが、キーボードの `v`（元記事を開く）が
   * 使うので運ぶ。**外すと `window.open(undefined)` で about:blank が開く**
   * ——型は `string | undefined` を受けるので、検査では気づけない。
   */
  url?: string;
  /** 書き手。リーダーの行には出していない。 */
  author?: string | null;
  published_at: string | null;
  /** RSSの抜粋。**要点（bullets）があるときは出さないので、そのときは運ばない。** */
  excerpt: string | null;
  /** 本文が取れたか。リーダーの行では見ていない（extracted_at で足りる）。 */
  content_ok?: boolean;
  /**
   * 本文抽出を試みた時刻。null は「まだ取りに行っていない」（0014）。
   * content_ok の false だけでは、失敗したのか順番待ちなのかが分からない。
   *
   * リーダーの行でしか見ないので `?`。アーカイブは運ばない。
   */
  extracted_at?: string | null;
  /**
   * こちらに入ってきた時刻（巡回で取り込んだとき）。
   *
   * 記事の日付（`published_at`）は**書き手が打ったもの**で、実際に読めるように
   * なった時刻とはずれる。省庁のように「日付は同じで、出てくるのは数日後」という
   * 出し方も普通にあるので、並び順と手元に来た順が食い違って見える。
   */
  created_at?: string | null;
  feed: { id: string; title: string } | null;
  /**
   * 要約。title_ja は設定言語での見出し（0023）。一覧では原題より
   * こちらを主にする。英語のフィードは記事の42%を占めていて、
   * 原題のままだと目で追うのが重い。
   */
  /**
   * 要約。title_ja は設定言語での見出し（0023）。
   *
   * bullets はリーダーの行では**先頭3つしか出していない**ので、そこまでしか
   * 運ばない。tags を出しているのはアーカイブだけなので `?`。
   */
  summary: {
    bullets: string[];
    tags?: string[];
    title_ja: string | null;
  } | null;
  /**
   * 既読・スター・あとで・書き出し済み。
   *
   * `is_read` と `read_later` はリーダーの一覧でしか見ないので `?`
   * ——アーカイブは運ばない。**運ばないものを false で埋めないこと。**
   * 「知っていて未読」と「そもそも運んでいない」は別の意味で、埋めると
   * 区別が消える（ui.md の「まだ何も無い状態を実在する値と同じにしない」）。
   */
  state: {
    is_read?: boolean;
    is_starred: boolean;
    read_later?: boolean;
    exported_at: string | null;
  } | null;
};

/**
 * サイドバーに出すフィード。**出しているものだけ**を必須にしてある。
 *
 * サイドバーは全ページに出る＝**遷移のたびに全フィードぶんが運ばれる**ので、
 * ここに列を足すとその費用も常時かかる。`site_url` と `last_fetched_at` は
 * 設定画面でしか使わないので `?`（`shell_data()` は返さない）。
 * 足すときは「サイドバーのどこに出るか」を先に決めること。
 */
export type FeedRow = {
  id: string;
  title: string;
  url: string;
  site_url?: string | null;
  folder_id: string | null;
  error_count: number;
  last_error: string | null;
  last_fetched_at?: string | null;
};

export type FolderRow = { id: string; name: string };

/**
 * URL から来た id が UUID の形をしているか。
 *
 * `?article=` `?folder=` `?feed=` は URL に出ているので、古いブックマーク・
 * 打ち間違い・リンクの切り貼りで UUID でない値がそのまま来る。素通しすると
 * Postgres が `invalid input syntax for type uuid`（22P02）で落ち、
 * **フォルダを1つ選び損ねただけのはずが、ページ全体が500になる**（一覧も
 * サイドバーも出ない）。実測で `/?folder=not-a-uuid` と `/?feed=not-a-uuid`
 * がこれだった。形が違えば「指定されていない」と同じ扱いにする。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_RE.test(value) ? value : undefined;
}

/** 一覧の表示モード。 */
export type View = 'unread' | 'starred' | 'later' | 'all' | 'unsummarized';

export const VIEW_LABELS: Record<View, string> = {
  unread: '未読',
  starred: 'スター',
  later: 'あとで',
  all: 'すべて',
  // ワーカーが要約を付けられなかった記事の置き場。ここから積み直せる。
  unsummarized: '要約なし',
};
