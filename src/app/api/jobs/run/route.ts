import { BATCH_SIZE, summarizeBatch, type SummaryInput } from '@/lib/ai/summarize';
import { extractArticle, htmlToText } from '@/lib/feeds/extract';
import { claim, complete, enqueue, fail, type Job } from '@/lib/jobs/queue';
import { authorizeCron, createAdminClient, ownerUserId } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ジョブワーカー。pg_cron から5分毎に叩かれる。
 *
 * 1回の実行で処理する量を絞ってあるので、記事が大量に入っても
 * Gemini の無料枠のレート制限に一度に当たらない。処理しきれなかったぶんは
 * 次の実行に持ち越される。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 本文取得は外部サイト次第で時間がかかる。長めに取る。
export const maxDuration = 60;

/** 1回の実行あたりの上限。extract は外部fetch、summarize は無料枠が律速。 */
const EXTRACT_PER_RUN = 12;
const SUMMARIZE_BATCHES_PER_RUN = 2;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createAdminClient();

  const extracted = await runExtractJobs(db);
  const summarized = await runSummarizeJobs(db);

  return Response.json({ extracted, summarized });
}

export const GET = POST;

/** 本文抽出。取れなければ RSS の内容にフォールバックし、いずれにせよ要約へ進める。 */
async function runExtractJobs(db: SupabaseClient): Promise<number> {
  const jobs = await claim(db, EXTRACT_PER_RUN, 'extract');
  let done = 0;

  for (const job of jobs) {
    const articleId = job.payload.article_id as string | undefined;
    if (!articleId) {
      await complete(db, job.id);
      continue;
    }

    try {
      const { data: article } = await db
        .from('articles')
        .select('id, url, content_text')
        .eq('id', articleId)
        .single();

      if (!article) {
        await complete(db, job.id);
        continue;
      }

      let text = '';
      let ok = false;
      try {
        const result = await extractArticle(article.url);
        text = result.text;
        ok = result.ok;
      } catch {
        // 403やタイムアウトは珍しくない。ここで再試行しても大抵また失敗するので、
        // RSSの内容で妥協して先へ進める。
      }

      if (!ok && article.content_text) {
        // poll の時点で入れた RSS 本文（HTML）をテキスト化して使う。
        text = htmlToText(article.content_text);
      }

      await db
        .from('articles')
        .update({ content_text: text || article.content_text, content_ok: ok })
        .eq('id', articleId);

      await enqueue(db, 'summarize', { article_id: articleId });
      await complete(db, job.id);
      done++;
    } catch (err) {
      await fail(db, job.id, err);
    }
  }

  return done;
}

/** 要約。複数記事を1リクエストにまとめて無料枠を節約する。 */
async function runSummarizeJobs(db: SupabaseClient): Promise<number> {
  // 要約は全ユーザー共通なので（0005）、言語も1つしか選べない。
  // 当面はオーナーの設定をその1つとして使う。購読者ごとに言語を変えたくなったら、
  // summaries を (article_id, language) で持つ形にする必要がある。
  const { data: settings } = await db
    .from('settings')
    .select('summary_language')
    .eq('user_id', ownerUserId())
    .maybeSingle();
  const language = settings?.summary_language ?? 'ja';

  let done = 0;

  for (let i = 0; i < SUMMARIZE_BATCHES_PER_RUN; i++) {
    const jobs = await claim(db, BATCH_SIZE, 'summarize');
    if (jobs.length === 0) break;

    const byArticle = new Map<string, Job>();
    for (const job of jobs) {
      const id = job.payload.article_id as string | undefined;
      if (id) byArticle.set(id, job);
      else await complete(db, job.id);
    }
    if (byArticle.size === 0) continue;

    const { data: articles } = await db
      .from('articles')
      .select('id, title, content_text, content_ok')
      .in('id', [...byArticle.keys()]);

    const inputs: SummaryInput[] = (articles ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      text: a.content_text ?? '',
      contentOk: a.content_ok,
    }));

    try {
      const { results, model } = await summarizeBatch(inputs, language);

      if (results.length > 0) {
        const { error } = await db.from('summaries').upsert(
          results.map((r) => ({
            article_id: r.id,
            bullets: r.bullets,
            tags: r.tags,
            importance: r.importance,
            model,
          })),
          { onConflict: 'article_id' },
        );
        if (error) throw error;
      }

      // 結果が返らなかった記事も、ここで再試行し続けると無料枠を食い潰す。
      // ジョブは完了扱いにして、必要なら手動で要約し直す。
      for (const job of byArticle.values()) await complete(db, job.id);
      done += results.length;
    } catch (err) {
      // RetryableError（429など）はバックオフして次回に回る。
      for (const job of byArticle.values()) await fail(db, job.id, err);
      break; // レート制限に当たっているなら、この実行では以降も失敗する。
    }
  }

  return done;
}
