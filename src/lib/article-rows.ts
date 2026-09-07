import { JST } from '@/lib/datetime';
import type { ArticleRow } from '@/lib/types';

/**
 * 一覧に出す行の組み立て。**画面から切り離してある**（ここは純関数だけ）。
 *
 * 一覧の中身は3か所から来る:
 *   1. サーバーが描く1ページ目（props の `articles`）
 *   2. 無限スクロールで継ぎ足したぶん（`extra`。ブラウザ側の state）
 *   3. 押した結果の上書き（`patches` と、本文側で付いた既読 `readMarks`）
 *
 * 重なり方に細かい決まりがあるので（下の `mergeRows`）、部品の中に置いたままだと
 * 検査できない。ここに出してテストを付けてある。
 */

/**
 * 行の状態の既定。**運んでいない列を false で埋めるためのものではない。**
 * 上書き（patch）を重ねるときに、元が null の行でも形を揃えるために使う。
 */
export const EMPTY_STATE = {
  is_read: false,
  is_starred: false,
  exported_at: null as string | null,
};

export type StatePatch = Partial<typeof EMPTY_STATE>;

/**
 * 1ページ目 + 継ぎ足し。id で重複を落とす（未読を読むと位置がずれるので、
 * 同じ記事が両方に入ることがある）。
 *
 * **重ねる先は1ページ目も含める。** 以前は継ぎ足したぶんにしか重ねていなかった。
 * 1ページ目はサーバーが描き直すから要らない、という理屈だったが、それは
 * 「開いた既読」が revalidate を連れていたときの話で、その描き直しをやめた今は
 * 押した結果がどこにも出なくなる（開いた記事が一覧では未読のまま残る）。
 *
 * **既読だけ別口（read-marks）なのは、本文側で付いたぶんも重ねたいから。**
 * 「次の記事」で読み進めると既読を書くのは MarkReadOnView で、あちらから
 * 一覧の state には触れない。
 *
 * **順番は「既読の印 → 押した操作」。** 押した操作（m・スワイプ）を後に重ねないと、
 * 開いて既読になったものを「未読に戻す」と押したときにこちらが勝ってしまう。
 *
 * 変えていない行は**同じ参照のまま返す**こと。行（Row）は memo してあるので、
 * ここで作り直すと一覧の60行が毎回描き直しになる。
 */
export function mergeRows({
  articles,
  extra,
  patches,
  readMarks,
}: {
  articles: ArticleRow[];
  extra: ArticleRow[];
  patches: Record<string, StatePatch>;
  readMarks: ReadonlySet<string>;
}): ArticleRow[] {
  const merge = (a: ArticleRow): ArticleRow => {
    const p = patches[a.id];
    const read = readMarks.has(a.id) ? { is_read: true } : null;
    if (!p && !read) return a;
    return { ...a, state: { ...EMPTY_STATE, ...a.state, ...read, ...p } };
  };

  const out = articles.map(merge);
  const seen = new Set(articles.map((a) => a.id));
  for (const a of extra) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(merge(a));
  }
  return out;
}

/**
 * 「取得」に出す時刻。
 *
 * 記事の日付と**同じ日なら時刻だけ**（`15:07`）、違う日なら日付から出す（`8/31`）。
 * 一覧に日付が2つ並ぶと、どちらが記事の日付なのか分からなくなる。知りたいのは
 * たいてい「ずれているかどうか」なので、ずれている日だけ日付が出れば足りる。
 *
 * **時間帯を必ず渡すこと。ここは hydration が食い違う場所だった。**
 * 呼ぶのはクライアント部品（ArticleList）だが、**最初の1枚はサーバーでも描かれる**。
 * 時間帯を渡さないと、サーバー（Vercel は UTC）とブラウザ（日本時間）で
 * 別の文字になり、React が hydration の食い違い（#418）として弾く。
 * 本番のコンソールに出続けていたのはこれ。
 */
export function formatFetched(fetched: string, published: string | null): string {
  const at = new Date(fetched);
  const day = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: JST });
  const sameDay = published && day(new Date(published)) === day(at);

  return sameDay
    ? at.toLocaleTimeString('ja-JP', { timeZone: JST, hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString('ja-JP', { timeZone: JST, month: 'numeric', day: 'numeric' });
}
