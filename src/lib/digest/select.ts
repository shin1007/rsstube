/**
 * 毎朝ダイジェストに載せる記事の選抜。
 *
 * **重要度は使わない**（0037）。以前は AI の 0〜100 で順位を付けていたが、
 * 重要度は記事の属性ではなく読み手との関係で決まるもので、記事に1つの数値として
 * 持たせること自体が誤りだった。代わりに**新しい順**で取る。
 *
 * 新しい順だけで上から取ると、更新の速いフォルダ（官公庁の新着など）で全部が
 * 埋まる。「今日の全体像」が欲しいのが目的なので、フォルダごとに上限を設けて
 * ばらけさせ、それでも枠が余ったら上限を外して埋める。この偏り対策は重要度とは
 * 関係なく要るので、重要度をやめても残してある。
 *
 * DB を触らない純粋な関数にしてあるのは、ここが唯一「音声の中身」を決める場所で、
 * 実データを流さずに挙動を固定しておきたいため。
 */

export type DigestCandidate = {
  id: string;
  /** 購読のフォルダ。未分類は null。 */
  folderId: string | null;
  publishedAt: string | null;
  /** 取り込んだ時刻。publishedAt が無い・当てにならないときの控え。 */
  createdAt?: string | null;
};

/**
 * 呼び出し側が付けた余分な項目（タイトルなど）を落とさずに返せるよう、
 * DigestCandidate を満たす型そのままで受けて返す。
 */
export function pickDigestArticles<T extends DigestCandidate>(
  candidates: T[],
  count: number,
): T[] {
  if (count <= 0) return [];

  // 新しい順。同時刻が並ぶことは珍しくない（自治体や省庁は同じ時刻でまとめて
  // 出す）ので、最後に id で決着を付けて並びを固定する。付けないと、実行計画が
  // 変わるたびに選ばれる記事が変わり、同じ日を作り直しても再現しない。
  const ranked = [...candidates].sort((a, b) => time(b) - time(a) || cmp(b.id, a.id));

  // 1フォルダで全体の1/3を超えないようにする。件数が少ないときは
  // ceil で最低1件は通るので、フォルダが1つしか無くても空にはならない。
  const perFolderMax = Math.max(1, Math.ceil(count / 3));
  const perFolder = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];

  for (const c of ranked) {
    if (picked.length >= count) break;
    const key = c.folderId ?? '';
    const used = perFolder.get(key) ?? 0;
    if (used >= perFolderMax) {
      overflow.push(c);
      continue;
    }
    perFolder.set(key, used + 1);
    picked.push(c);
  }

  // 上限のせいで枠が余ったら、はみ出したぶんから新しい順に埋め戻す。
  // 偏りを避けるのは「他に選べるものがあるとき」だけでよい。
  for (const c of overflow) {
    if (picked.length >= count) break;
    picked.push(c);
  }

  // 最後にもう一度新しい順へ。埋め戻しで順番が崩れているため。
  return picked.sort((a, b) => time(b) - time(a) || cmp(b.id, a.id));
}

/**
 * 並びに使う時刻。`published_at` を先に見て、無ければ取り込んだ時刻を使う。
 * 何日も前の日付で流れてくるフィードがあるが、選抜の母数は既に「過去24時間に
 * 取り込んだぶん」に絞ってあるので、ここで古い日付が混ざっても最後尾に回るだけ。
 */
function time(c: DigestCandidate): number {
  for (const value of [c.publishedAt, c.createdAt]) {
    if (!value) continue;
    const t = new Date(value).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
