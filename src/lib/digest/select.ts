/**
 * 毎朝ダイジェストに載せる記事の選抜。
 *
 * **重要度は使わない**（0037）。以前は AI の 0〜100 で順位を付けていたが、
 * 重要度は記事の属性ではなく読み手との関係で決まるもので、記事に1つの数値として
 * 持たせること自体が誤りだった。代わりに**新しい順**で取る。
 *
 * ただし新しい順だけで上から取ると、更新の速いフィードで全部が埋まる。実測で
 * 直近7日の取り込みは厚労省87件・弁護士のブログ1件と**87倍**の開きがあり、
 * 8件の枠は上位3フィードで7割が埋まっていた。件数の偏りは点数の偏りより桁が
 * 大きい（点数は0〜100で有界だが、件数に上限は無い）ので、**重要度をやめた
 * あとのほうが偏り対策は要る**。
 *
 * 上限は**フィードごと**に掛ける（2026-09-03）。以前はフォルダごとだったが、
 * フォルダ分けをするかどうかは読む人の趣味で、**やるかどうかで朝のまとめの
 * 中身が変わるべきではない**。偏りが起きているのもフィード単位だった
 * （ある日の8件のうち5件が1フィードから）。フィードは購読すれば必ずあるので、
 * 設定を何もしなくても効く。
 *
 * DB を触らない純粋な関数にしてあるのは、ここが唯一「音声の中身」を決める場所で、
 * 実データを流さずに挙動を固定しておきたいため。
 */

export type DigestCandidate = {
  id: string;
  /** どのフィードから来たか。上限をここで数える。 */
  feedId: string;
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

  const perFeedMax = feedCap(ranked, count);
  const perFeed = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];

  for (const c of ranked) {
    if (picked.length >= count) break;
    const used = perFeed.get(c.feedId) ?? 0;
    if (used >= perFeedMax) {
      overflow.push(c);
      continue;
    }
    perFeed.set(c.feedId, used + 1);
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
 * 1フィードから取ってよい上限。
 *
 * **その日に記事があるフィードの数から決める。** 固定の割合（「全体の1/3まで」
 * など）にすると、購読が増えても減っても同じ数のままで、実態と合わなくなる:
 * フィードが2本しか動かなかった日は上限が厳しすぎて枠が埋まらず、20本動いた
 * 日は緩すぎて偏りを止められない。
 *
 * 枠を均等に割った数にすれば、どちらも自分で追いつく。動いたフィードが1本
 * だけの日は上限が枠と同じになり（＝実質上限なし）、その1本で埋まる——
 * 他に選べるものが無いので、それが正しい。
 */
function feedCap(candidates: DigestCandidate[], count: number): number {
  const feeds = new Set(candidates.map((c) => c.feedId)).size;
  if (feeds === 0) return count;
  return Math.max(1, Math.ceil(count / feeds));
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
