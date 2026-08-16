import { BATCH_SIZE, summarizeBatch, type SummaryInput } from '@/lib/ai/summarize';
import { SUMMARY_MODEL } from '@/lib/ai/gemini';
import { recordUsage } from '@/lib/ai/usage';
import { contentHash, usableAsFallback } from '@/lib/feeds/content';
import { normalizeLanguage } from '@/lib/language';
import { sanitizeHtml } from '@/lib/feeds/sanitize';
import { extractArticle, htmlToText } from '@/lib/feeds/extract';
import { claim, complete, enqueue, fail, type Job } from '@/lib/jobs/queue';
import { runScriptJob, runTtsJob, TTS_PER_RUN } from '@/lib/media/jobs';
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
/** 台本は1本作るだけで数千トークン出るので、1回の実行につき1本まで。 */
const SCRIPT_PER_RUN = 1;

/**
 * 1回の実行に使ってよい時間。
 *
 * 件数だけで絞っても、1件あたりの時間は相手次第で読めない（TTS は1セグメントに
 * 数十秒かかることがある）。maxDuration=60 を超えると関数ごと落とされ、
 * 途中の running のジョブが宙に浮く（0004 の回収待ちになる）。
 * 残り時間を見ながら、次の種類に進む前に切り上げる。
 */
const TIME_BUDGET_MS = 45_000;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createAdminClient();
  const deadline = Date.now() + TIME_BUDGET_MS;

  const extracted = await runExtractJobs(db, deadline);
  const summarized = await runSummarizeJobs(db, deadline);
  // 音声は要約より後。要約が付いていない記事から台本を作っても薄くなる。
  const scripted = await runScriptJobs(db, deadline);
  const synthesized = await runTtsJobs(db, deadline);

  return Response.json({
    extracted,
    summarized,
    scripted,
    synthesized,
    // 予算を使い切ったなら、残りは次の実行に持ち越されている。
    outOfTime: Date.now() >= deadline,
  });
}

export const GET = POST;

/** 本文抽出。取れなければ RSS の内容にフォールバックし、いずれにせよ要約へ進める。 */
async function runExtractJobs(db: SupabaseClient, deadline: number): Promise<number> {
  const jobs = await claim(db, EXTRACT_PER_RUN, 'extract');
  let done = 0;

  for (const job of jobs) {
    // 引いたぶんを全部やり切る必要はない。残りは次の実行が拾い直す（0004）。
    if (Date.now() >= deadline) break;
    const articleId = job.payload.article_id as string | undefined;
    if (!articleId) {
      await complete(db, job.id);
      continue;
    }

    try {
      const { data: article } = await db
        .from('articles')
        .select('id, url, feed_id, rss_html, excerpt')
        .eq('id', articleId)
        .single();

      if (!article) {
        await complete(db, job.id);
        continue;
      }

      /**
       * RSS の中身で妥協する。抽出が失敗したときと、掴んだものが記事で
       * なかったとき（使い回しページ）の両方から呼ぶ。
       *
       * 使えないときは**何も返さない**。「Comments」のような、本文の代わりに
       * ならない説明文を保存すると、一覧にも要約にもそれが並ぶ。
       */
      const fromRss = (): { text: string; html: string } | null => {
        // **content_text を見てはいけない。** あの列は抽出結果で上書きされるので、
        // 取り直しのときに読むと前回掴んだゴミが返ってくる（東洋経済で実際に
        // メニュー1244字を「RSSの内容」として拾い直していた）。
        // 0021 で足した rss_html が上書きされない控え。古い記事にはまだ無いので、
        // そのときは excerpt を使う（東洋経済の場合はここに実要約が入っている）。
        for (const source of [article.rss_html, article.excerpt]) {
          if (!source) continue;
          const t = htmlToText(source);
          if (!usableAsFallback(t)) continue;
          // RSS の中身も第三者が書いたものなので、描画に回すぶんは必ず消毒する。
          return { text: t, html: sanitizeHtml(source, article.url) };
        }
        return null;
      };

      let text = '';
      let html = '';
      let ok = false;
      try {
        const result = await extractArticle(article.url);
        text = result.text;
        html = result.html;
        ok = result.ok;
      } catch {
        // 403やタイムアウトは珍しくない。ここで再試行しても大抵また失敗するので、
        // RSSの内容で妥協して先へ進める。
      }

      // 同じフィードで本文が丸ごと一致したら、記事ではなく使い回しのページ
      // （エラーページ・同意画面・グローバルメニュー）とみなす。
      let hash: string | null = null;
      if (ok) {
        hash = contentHash(text);
        if (hash && (await isRecycledPage(db, article.feed_id, articleId, hash))) {
          ok = false;
        }
      }

      if (!ok) {
        // **ここが抜けていた。** 使い回しと判定したあとに落とし直していなかったので、
        // 掴んだメニューがそのまま content_text に残っていた（東洋経済で実際に
        // 「有料会員登録 お知らせ ビジネス…」が1244字ぶん保存されていた）。
        // 判定したなら中身も捨てること。
        const rss = fromRss();
        text = rss?.text ?? '';
        html = rss?.html ?? '';
      }

      await db
        .from('articles')
        .update({
          // 使えるものが無ければ空にする。ゴミを残すくらいなら
          // 「取れなかった」と分かるほうがよい（一覧には excerpt が出る）。
          content_text: text || null,
          // 描画用。抽出に失敗しても RSS 本文から作れていれば残す。
          content_html: html || null,
          content_ok: ok,
          // 使い回しと判定したものはハッシュを残さない。残すと、次の記事が
          // それと一致して連鎖的に落ちる（判定の基準が壊れたページになる）。
          content_hash: ok ? hash : null,
          // 取りに行ったことを残す。これが無いと、失敗したのか順番待ちなのかが
          // 後から区別できない（0014）。
          extracted_at: new Date().toISOString(),
        })
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
async function runSummarizeJobs(db: SupabaseClient, deadline: number): Promise<number> {
  // 要約は全ユーザー共通なので（0005）、言語も1つしか選べない。
  // 当面はオーナーの設定をその1つとして使う。購読者ごとに言語を変えたくなったら、
  // summaries を (article_id, language) で持つ形にする必要がある。
  const { data: settings } = await db
    .from('settings')
    .select('summary_language')
    .eq('user_id', ownerUserId())
    .maybeSingle();
  const language = normalizeLanguage(settings?.summary_language);

  let done = 0;

  for (let i = 0; i < SUMMARIZE_BATCHES_PER_RUN; i++) {
    if (Date.now() >= deadline) break;
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
      const { results, model, usage } = await summarizeBatch(inputs, language);
      await recordUsage(db, model, usage.inputTokens, usage.outputTokens, true);

      if (results.length > 0) {
        const { error } = await db.from('summaries').upsert(
          results.map((r) => ({
            article_id: r.id,
            // 空で返ってきたら列を埋めない。空文字を入れると「訳した結果が空」と
            // 区別できず、画面側で原題に戻す判断ができなくなる。
            title_ja: r.title_ja?.trim() || null,
            bullets: r.bullets,
            tags: r.tags,
            importance: r.importance,
            model,
          })),
          { onConflict: 'article_id' },
        );
        if (error) throw error;
      }

      // 返ってきたぶんは完了。
      const returned = new Set(results.map((r) => r.id));
      for (const [articleId, job] of byArticle) {
        if (returned.has(articleId)) await complete(db, job.id);
      }

      /**
       * 返らなかった記事は**1回だけ**やり直させる。
       *
       * モデルは5件のうち1件を落とすことがある。以前はここで完了扱いにしていたので、
       * 落ちた記事には二度と要約が付かなかった（実データで5件が取り残されていた）。
       * かといって無制限に再試行すると無料枠を食い潰す。
       *
       * `fail_job` の max_attempts に 2 を渡し、2回目で諦めさせる。次の回では
       * 別の記事と組み合わさるので、同じ落ち方をする確率は低い。
       * 諦めたものは「要約なし」ビューに残り、手で積み直せる。
       */
      for (const [articleId, job] of byArticle) {
        if (returned.has(articleId)) continue;
        const { error } = await db.rpc('fail_job', {
          job_id: job.id,
          err: 'モデルがこの記事を返しませんでした',
          max_attempts: 2,
        });
        if (error) throw error;
      }

      done += results.length;
    } catch (err) {
      // 失敗した呼び出しも RPD を1回ぶん食う（429 で弾かれた場合は特に、
      // 「もう上限に当たっている」ことが数字に出ていないと原因を追えない）。
      await recordUsage(db, SUMMARY_MODEL, 0, 0, false);

      // RetryableError（429など）はバックオフして次回に回る。
      for (const job of byArticle.values()) await fail(db, job.id, err);
      break; // レート制限に当たっているなら、この実行では以降も失敗する。
    }
  }

  return done;
}

/** 台本作り。1本ぶんで数千トークン出るので、1回の実行につき1本だけ進める。 */
async function runScriptJobs(db: SupabaseClient, deadline: number): Promise<number> {
  if (Date.now() >= deadline) return 0;
  const jobs = await claim(db, SCRIPT_PER_RUN, 'script');
  let done = 0;
  for (const job of jobs) {
    if (await runScriptJob(db, job)) done++;
  }
  return done;
}

/**
 * 音声合成。スライド1枚ぶんが1回。
 *
 * 1本の番組が10前後のセグメントになるので、1回の実行で4つずつ進めると
 * 3回ほどの実行（15分ほど）で1本仕上がる。朝までに間に合えばよいので、
 * 無料枠を一度に食わないほうを取る。
 */
async function runTtsJobs(db: SupabaseClient, deadline: number): Promise<number> {
  if (Date.now() >= deadline) return 0;
  const jobs = await claim(db, TTS_PER_RUN, 'tts');
  let done = 0;
  for (const job of jobs) {
    // 1セグメントに数十秒かかることがあるので、毎回残り時間を見る。
    if (Date.now() >= deadline) break;
    if (await runTtsJob(db, job)) done++;
  }
  return done;
}

/**
 * 同じ本文が、同じフィードの別の記事で既に使われていないか。
 *
 * 使い回しのページ（エラーページ・同意画面）はどのURLでも同じものを返すので、
 * ここで一致する。本物の記事どうしが完全一致することは原理的に無いため、
 * 誤検出は起きない。
 *
 * 見つかったときは**先に保存されていたほうも取り消す**。1件目は比べる相手が
 * まだ無かっただけで、同じ使い回しのページを本文として持っている。
 */
async function isRecycledPage(
  db: SupabaseClient,
  feedId: string,
  articleId: string,
  hash: string,
): Promise<boolean> {
  const { data: same } = await db
    .from('articles')
    .select('id')
    .eq('feed_id', feedId)
    .eq('content_hash', hash)
    .neq('id', articleId)
    .limit(1);

  if (!same?.length) return false;

  // 取り消す対象を先に控える。update のあとでは content_hash が消えて引けない。
  const { data: peers } = await db
    .from('articles')
    .select('id')
    .eq('feed_id', feedId)
    .eq('content_hash', hash);

  await db
    .from('articles')
    .update({
      content_ok: false,
      content_hash: null,
      // **本文も一緒に捨てる。** 印だけ外して中身を残すと、掴んでしまった
      // メニューが本文として画面に出続ける（東洋経済で実際にそうなっていた）。
      content_text: null,
      content_html: null,
    })
    .eq('feed_id', feedId)
    .eq('content_hash', hash);

  // 消しっぱなしにせず、取り直させる。RSS の中身に落とし直せば
  // 「メニューしか無い」より読めるものが残る。
  for (const peer of peers ?? []) {
    if (peer.id !== articleId) await enqueue(db, 'extract', { article_id: peer.id });
  }

  return true;
}
