/**
 * 一覧を1回に取る件数。無限スクロールはこの単位で継ぎ足す。
 *
 * types に置いてあるのは、クライアント側（ArticleList）にも同じ数が要るため。
 * lib/articles.ts に置いたままにすると、そこから next/headers を引いているので
 * クライアントコンポーネントにサーバ専用のコードが混ざる。
 */
export const PAGE_SIZE = 60;

/**
 * 一覧の1行。**リーダーの一覧（/）と アーカイブ（/library）で運ぶ列が違う。**
 *
 * `?` が付いているのはアーカイブだけが使う列。リーダーの一覧は記事を開くたびに
 * 60行ぶんまるごと運び直すので（RSC のペイロードは実測61KB / 24行）、
 * **画面に出していない列を1つ足すと、その重さが全部の遷移に乗る**。
 * 出していないものは運ばないこと。
 */
export type ArticleRow = {
  id: string;
  title: string;
  /** 元記事へのリンク。リーダーの行には出していない（開いてから出す）。 */
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
   */
  extracted_at: string | null;
  /**
   * こちらに入ってきた時刻（巡回で取り込んだとき）。
   *
   * 記事の日付（`published_at`）は**書き手が打ったもの**で、実際に読めるように
   * なった時刻とはずれる。省庁のように「日付は同じで、出てくるのは数日後」という
   * 出し方も普通にあるので、並び順と手元に来た順が食い違って見える。
   */
  created_at: string | null;
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
    importance: number;
    title_ja: string | null;
  } | null;
  state: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

export type FeedRow = {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  folder_id: string | null;
  error_count: number;
  last_error: string | null;
  last_fetched_at: string | null;
};

export type FolderRow = { id: string; name: string };

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
