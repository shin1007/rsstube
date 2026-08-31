/**
 * この画面で既読にした記事を、ブラウザ側だけで覚えておく（再読み込みで消える）。
 *
 * 役目は2つ。
 *
 * 1. **二度書きを止める。** 一覧で開いた記事は ArticleList の `open` が既読にするが、
 *    開いた先の本文には MarkReadOnView も居る。開くのと既読を書くのは同時に走るので、
 *    **本文を描くサーバーの読み取りが書き込みに勝つと `is_read` はまだ false** で返り、
 *    同じ記事にもう1通 markRead が飛んでいた。
 *
 * 2. **一覧の行に反映する。** 既読は「押した結果が画面に出る操作」ではないので
 *    revalidate を付けていない（`actions/articles.ts` の setState）。付ければ
 *    `/` の描き直しが応答に乗ってくるうえ、**先読みしておいたぶんも一緒に捨てられる**
 *    ので、次の記事へ移るたびに待ち時間が戻ってしまう。代わりにここへ覚えて、
 *    一覧が自分で重ねる。「次の記事」で読み進めたぶんもこれで一覧に出る。
 *
 * サーバーの値と食い違ったとしても、行き先は必ず「既読」なので直しに行く必要は無い。
 */
const marked = new Set<string>();
const listeners = new Set<() => void>();

/** useSyncExternalStore は同じ参照が返る限り再描画しないので、変えるたびに作り直す。 */
let snapshot: ReadonlySet<string> = new Set();

/** サーバー描画用。毎回同じものを返さないと無限に描き直しになる。 */
const EMPTY: ReadonlySet<string> = new Set();

export function rememberRead(articleId: string) {
  if (marked.has(articleId)) return;
  marked.add(articleId);
  snapshot = new Set(marked);
  for (const listen of listeners) listen();
}

export function alreadyMarkedRead(articleId: string) {
  return marked.has(articleId);
}

export function subscribeReadMarks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readMarksSnapshot(): ReadonlySet<string> {
  return snapshot;
}

export function readMarksServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}
