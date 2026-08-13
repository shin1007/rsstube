/**
 * 毎朝ダイジェストに載せる記事の選抜。
 *
 * 重要度順に上から取るだけだと、たまたま当たりの多いフォルダ（技術ニュースなど）で
 * 全部埋まる。「今日の全体像」が欲しいのが目的なので、フォルダごとに上限を設けて
 * ばらけさせ、それでも枠が余ったら上限を外して重要度順に埋める。
 *
 * DB を触らない純粋な関数にしてあるのは、ここが唯一「音声の中身」を決める場所で、
 * 実データを流さずに挙動を固定しておきたいため。
 */

export type DigestCandidate = {
  id: string;
  /** 0-100。要約がまだ無い記事は null。 */
  importance: number | null;
  /** 購読のフォルダ。未分類は null。 */
  folderId: string | null;
  publishedAt: string | null;
};

/** 要約がまだ付いていない記事の扱う重要度。既定値(50)より下に置いて後回しにする。 */
const NO_SUMMARY_IMPORTANCE = 30;

/**
 * 呼び出し側が付けた余分な項目（タイトルなど）を落とさずに返せるよう、
 * DigestCandidate を満たす型そのままで受けて返す。
 */
export function pickDigestArticles<T extends DigestCandidate>(
  candidates: T[],
  count: number,
): T[] {
  if (count <= 0) return [];

  // 重要度が同じなら新しいものを優先。
  const ranked = [...candidates].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return time(b) - time(a);
  });

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

  // 上限のせいで枠が余ったら、はみ出したぶんから重要度順に埋め戻す。
  // 偏りを避けるのは「他に選べるものがあるとき」だけでよい。
  for (const c of overflow) {
    if (picked.length >= count) break;
    picked.push(c);
  }

  // 最後にもう一度重要度順へ。埋め戻しで順番が崩れているため。
  return picked.sort((a, b) => score(b) - score(a) || time(b) - time(a));
}

function score(c: DigestCandidate): number {
  return c.importance ?? NO_SUMMARY_IMPORTANCE;
}

function time(c: DigestCandidate): number {
  if (!c.publishedAt) return 0;
  const t = new Date(c.publishedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}
