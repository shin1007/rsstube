import type { MediaSummary } from '@/lib/media/list';

/**
 * 音声ができあがる時刻の見当。
 *
 * 押してから聴けるまで十数分かかる。その間ずっと「順番待ち」とだけ出ていると、
 * 進んでいるのか止まっているのかが分からない。件数（3/5）だけでは、
 * 1件にどれくらいかかるのかが分からないので時間の見当がつかない。
 *
 * **正確な予測はできないし、しようとしない。** 相手（Gemini）の応答時間も、
 * 無料枠の空き具合も、こちらからは見えない。「だいたいこのくらい」が出れば、
 * 待つか出直すかは決められる。
 */

/** pg_cron がワーカーを叩く間隔（supabase/scheduler.sql）。 */
const CRON_INTERVAL_MIN = 5;

/**
 * 1回の実行で仕上がるセグメント数の目安。
 *
 * TTS_PER_RUN は4だが、実際には TIME_BUDGET_MS（45秒）が先に来る。
 * 本番のワーカーを叩いて数えたところ、1回で 1〜2件（outOfTime で切り上げ）。
 * **件数の上限（4）を使ってはいけない。**いつも早すぎる見込みになり、
 * 出した時刻を過ぎても終わらないほうが、何も出さないより悪い。
 */
const SEGMENTS_PER_RUN = 1.5;

/**
 * 台本ができる前の、セグメント数の仮置き。
 *
 * 記事1本なら5枚（lib/ai/script.ts の slideTarget）。ダイジェストはもっと多いが、
 * 台本ができれば実数に置き換わるので、控えめな側に倒しておく。
 */
const ASSUMED_SEGMENTS = 5;

/** 台本づくりは1回の実行につき1本（SCRIPT_PER_RUN）。 */
const SCRIPT_RUNS = 1;

/**
 * あと何回ワーカーが回れば終わるか。
 *
 * @returns 終わっている（または失敗した）なら null
 */
export function runsRemaining(
  media: Pick<MediaSummary, 'status' | 'doneSegments' | 'totalSegments'>,
): number | null {
  if (media.status === 'ready' || media.status === 'failed') return null;

  // 台本がまだなら、セグメントの数も分からない。仮置きで見積もる。
  if (media.status === 'queued' || media.status === 'scripting') {
    return SCRIPT_RUNS + Math.ceil(ASSUMED_SEGMENTS / SEGMENTS_PER_RUN);
  }

  const remaining = Math.max(0, media.totalSegments - media.doneSegments);
  // 残り0でまだ ready でないなら、次の回で締めが走る。
  return Math.max(1, Math.ceil(remaining / SEGMENTS_PER_RUN));
}

/** できあがりそうな時刻。終わっているものには出さない。 */
export function estimateFinishAt(
  media: Pick<MediaSummary, 'status' | 'doneSegments' | 'totalSegments'>,
  now: Date = new Date(),
): Date | null {
  const runs = runsRemaining(media);
  if (runs === null) return null;
  return new Date(now.getTime() + runs * CRON_INTERVAL_MIN * 60_000);
}

/** 「10:45」。日本時間で出す（ダイジェストの時刻設定も日本時間で扱っている）。 */
export function formatEta(at: Date): string {
  return at.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
}
