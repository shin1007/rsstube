import { pollFeeds, type PollableFeed } from '@/lib/feeds/poll';
import { authorizeCron, createAdminClient } from '@/lib/supabase/admin';

/**
 * フィード巡回。pg_cron から1時間毎に叩かれる（supabase/scheduler.sql）。
 *
 * Vercel Hobby の cron は1日1回までなので、定期実行は Supabase 側に持たせている。
 *
 * フィードと記事は全ユーザー共通なので、巡回は1回で全員ぶんを兼ねる（0005）。
 * ユーザーごとに違うのは「誰がそのフィードを購読しているか」だけで、それは
 * 新着記事の未読行を作るところにだけ効く。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 1回の実行で巡回するフィード数。サーバーレス関数の実行時間に収まる程度に抑える。 */
const FEEDS_PER_RUN = 40;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createAdminClient();

  /**
   * 最後に取得してから古い順。連続失敗しているフィードは間隔を空ける
   * （error_count 時間ぶん待つ。10回失敗すれば10時間に1回まで落ちる）。
   *
   * **`feeds` を直に見ないこと（`0029`）。** feeds は全ユーザー共通で購読の有無を
   * 持たないので、直に見ると**購読をやめたフィードも毎時取りに行き続ける**。
   * 記事は入り続け、本文抽出と要約（Gemini の無料枠）もそのまま走るのに、
   * 画面には出ないので表からは分からない。掃除（purge_orphan_feeds）は
   * スターや書き出し済みの記事が残っているフィードを消さないため、
   * 印を付けた記事があるフィードは解除後も永久に残り、永久に巡回されていた。
   */
  const { data: feeds, error } = await db.rpc('feeds_to_poll', { job_limit: FEEDS_PER_RUN });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 実際に取りに行くところは lib/feeds/poll.ts。画面の「引っぱって更新」と共有する。
  const result = await pollFeeds(db, (feeds ?? []) as PollableFeed[]);

  return Response.json(result);
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;
