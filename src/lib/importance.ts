/**
 * 重要度の見せ方。
 *
 * 0〜100 の数字は、それ単体では何のことか分からない。どういう基準で付いた点数
 * なのかと、いまの記事がその中のどのへんなのかが要る。基準は要約プロンプト
 * （src/lib/ai/summarize.ts）と同じもので、片方だけ変えると表示が嘘になる。
 */

/** 点数を付ける基準。プロンプトに書いてあるものと同じ。 */
export const IMPORTANCE_CRITERIA = [
  '新規性がある',
  '影響範囲が広い',
  '一次情報である',
  '実務や判断に使える',
] as const;

export const IMPORTANCE_HELP =
  `AIが記事ごとに0〜100で付けた点数です。50が平均で、${IMPORTANCE_CRITERIA.join('・')}` +
  'ものを高く、続報のない小ネタ・宣伝・既出の焼き直しを低くしています。';

export type ImportanceTier = {
  /** 「高」「中」など、数字の代わりに読ませる語。 */
  label: string;
  /** 一覧のバッジに出すか。低いものまで出すと画面が点数だらけになる。 */
  badge: boolean;
  className: string;
};

export function importanceTier(score: number): ImportanceTier {
  if (score >= 85) {
    return { label: '高', badge: true, className: 'bg-amber-900/60 text-amber-300' };
  }
  if (score >= 70) {
    return { label: 'やや高', badge: true, className: 'bg-amber-950/60 text-amber-400/80' };
  }
  if (score >= 40) {
    return { label: '並', badge: false, className: 'bg-zinc-800 text-zinc-400' };
  }
  return { label: '低', badge: false, className: 'bg-zinc-800 text-zinc-500' };
}

/** ツールチップと読み上げに使う一行。 */
export function importanceTitle(score: number): string {
  return `重要度 ${importanceTier(score).label}（${score}／100）— ${IMPORTANCE_HELP}`;
}
