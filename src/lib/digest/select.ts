/**
 * 毎朝ダイジェストに載せる記事の選抜。
 *
 * 重要度順に上から取るだけだと、たまたま当たりの多いフォルダ（技術ニュースなど）で
 * 全部埋まる。「今日の全体像」が欲しいのが目的なので、フォルダごとに上限を設けて
 * ばらけさせ、それでも枠が余ったら上限を外して重要度順に埋める。
 *
 * 重要度そのものは全ユーザー共通（0005）で、基準も読み手を見ていない一般的な
 * ニュース価値でしかない。そこに**フォルダごとの重み**（0036）を掛けたものを
 * 順位に使う。素の点数は共通のまま、順位だけが人ごとに変わる。
 *
 * DB を触らない純粋な関数にしてあるのは、ここが唯一「音声の中身」を決める場所で、
 * 実データを流さずに挙動を固定しておきたいため。
 */

export type DigestCandidate = {
  id: string;
  /** 0-100。要約がまだ無い記事は null。全ユーザー共通の素の点数。 */
  importance: number | null;
  /** 購読のフォルダ。未分類は null。 */
  folderId: string | null;
  publishedAt: string | null;
  /**
   * フォルダの重み（%）。100 が素通し、0 は出さない。
   * 未分類のフィードは重みの置き場が無いので、省略＝100 として扱う。
   */
  weight?: number | null;
};

/** 要約がまだ付いていない記事の扱う重要度。既定値(50)より下に置いて後回しにする。 */
const NO_SUMMARY_IMPORTANCE = 30;

/** 重みの既定。フォルダに入っていない記事と、列がまだ無いときの値。 */
const DEFAULT_WEIGHT = 100;

/**
 * 順位に使う点数。素の重要度にフォルダの重みを掛けたもの。
 * 下見（`?dry=1`）で「なぜこれが選ばれたか」を出すために公開している。
 */
export function effectiveScore(c: DigestCandidate): number {
  const base = c.importance ?? NO_SUMMARY_IMPORTANCE;
  return (base * weightOf(c)) / 100;
}

/**
 * 呼び出し側が付けた余分な項目（タイトルなど）を落とさずに返せるよう、
 * DigestCandidate を満たす型そのままで受けて返す。
 */
export function pickDigestArticles<T extends DigestCandidate>(
  candidates: T[],
  count: number,
): T[] {
  if (count <= 0) return [];

  /**
   * **重み 0 は掛け算ではなく除外で扱う。**
   *
   * 掛けるだけだと点数が 0 になって最後尾に回るが、下の「枠が余ったら埋め戻す」
   * を通って結局載る。設定画面には「ダイジェストに出さない」と書くので、
   * 他に候補が無い日だけ載るのでは表示が嘘になる。
   */
  const eligible = candidates.filter((c) => weightOf(c) > 0);

  // 重み込みの点数が同じなら新しいものを優先。
  const ranked = [...eligible].sort((a, b) => {
    const diff = effectiveScore(b) - effectiveScore(a);
    if (diff !== 0) return diff;
    return time(b) - time(a);
  });

  // 1フォルダで全体の1/3を超えないようにする。件数が少ないときは
  // ceil で最低1件は通るので、フォルダが1つしか無くても空にはならない。
  //
  // 重みを上げたフォルダにもこの上限は効く。重みは「同じ枠の中で先に取る」
  // ためのもので、枠そのものを増やすと全体像を配るという目的が崩れる。
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
  return picked.sort((a, b) => effectiveScore(b) - effectiveScore(a) || time(b) - time(a));
}

function weightOf(c: DigestCandidate): number {
  const w = c.weight;
  // null と undefined は「未設定」。0 は意味のある値なので ?? では潰さない。
  if (typeof w !== 'number' || Number.isNaN(w)) return DEFAULT_WEIGHT;
  return Math.max(0, w);
}

function time(c: DigestCandidate): number {
  if (!c.publishedAt) return 0;
  const t = new Date(c.publishedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}
