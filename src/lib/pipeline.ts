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

/** 自分が購読している記事だけを数える（記事自体は全ユーザー共通なので）。 */
const SELECT = 'id, article_states!inner (is_read), summaries (article_id)';

export async function pipelineStatus(): Promise<PipelineStatus> {
  const supabase = await createClient();

  const [pending, failed, unsummarized] = await Promise.all([
    supabase.from('articles').select(SELECT, { count: 'exact', head: true }).is('extracted_at', null),
    supabase
      .from('articles')
      .select(SELECT, { count: 'exact', head: true })
      .not('extracted_at', 'is', null)
      .eq('content_ok', false),
    supabase
      .from('articles')
      .select(SELECT, { count: 'exact', head: true })
      .not('extracted_at', 'is', null)
      .is('summaries', null),
  ]);

  return {
    pendingExtract: pending.count ?? 0,
    failedExtract: failed.count ?? 0,
    pendingSummary: unsummarized.count ?? 0,
  };
}
