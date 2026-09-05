import { createClient } from '@/lib/supabase/server';

/**
 * 取り込みの進み具合。
 *
 * 記事が入ってから読める形になるまでには、本文抽出 → 要約という2段がある。
 * フィードを増やした直後はここに数百件たまるが、画面上は「要約の無い記事」が
 * 並ぶだけなので、**壊れているのか順番待ちなのかが分からない**。
 * 実際そう読み違えた（順番待ち252件を「抽出に失敗」と数えた）。
 *
 * 数を出しておけば、待てばいいのか手当てが要るのかが判断できる。
 */

export type PipelineStatus = {
  /** まだ本文を取りに行っていない記事。待てば減る。 */
  pendingExtract: number;
  /** 取りに行って取れなかった記事。待っても減らない。 */
  failedExtract: number;
  /** 本文は処理済みだが要約がまだ付いていない記事。 */
  pendingSummary: number;
};

/**
 * 数えるのは DB 側（0038 の `pipeline_status()`）。
 *
 * 以前はここから `count: 'exact'` の問い合わせを3本投げていた。並べて投げては
 * いたが、**3本とも articles ⋈ article_states を丸ごと数える同じ走査**で、
 * 違うのは filter だけ。いちばん遅い1本しか効かないので（perf.md）、
 * 待ち時間はそのまま最遅の127msだった。1本にまとめれば走査も1回で済む。
 *
 * 自分が購読している記事だけを数えるのは関数の中でやっている
 * （記事自体は全ユーザー共通なので、article_states が切り出しを兼ねる）。
 */
export async function pipelineStatus(): Promise<PipelineStatus> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('pipeline_status').maybeSingle();
  if (error) throw error;

  const row = data as {
    pending_extract: number;
    failed_extract: number;
    pending_summary: number;
  } | null;

  return {
    pendingExtract: Number(row?.pending_extract ?? 0),
    failedExtract: Number(row?.failed_extract ?? 0),
    pendingSummary: Number(row?.pending_summary ?? 0),
  };
}
