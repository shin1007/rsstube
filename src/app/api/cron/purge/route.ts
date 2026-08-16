import { authorizeCron, createAdminClient } from '@/lib/supabase/admin';

/**
 * 古い音声を消す。
 *
 * Storage の無料枠は1GB。10分の番組が約4.6MB なので、毎朝1本でも半年ほどで
 * 埋まる。記事単位の深掘りが増えればもっと早い。放っておくと、ある日
 * 「音声が作れない」だけの形で静かに壊れる。
 *
 * SQL 側の掃除（purge_jobs / purge_article_bodies）と違って、ここは
 * ルートにある。Storage のファイルを消すのに API が要るためで、
 * 行だけ消してもファイルは残る（そちらが容量の実体）。
 *
 * pg_cron から1日1回。supabase/scheduler.sql の rsstube-media-purge。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 既定の保持日数。settings.media_retention_days が無いときに使う。 */
const DEFAULT_RETENTION_DAYS = 30;

/** 1回で消す本数の上限。消し忘れは翌日また拾える。 */
const PER_RUN = 50;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createAdminClient();

  const { data: settings } = await db.from('settings').select('user_id, media_retention_days');
  const retentionByUser = new Map(
    (settings ?? []).map((s) => [s.user_id as string, s.media_retention_days as number]),
  );

  // 一番長い保持期間より古いものだけを候補にする。ユーザーごとの判定は後で。
  const longest = Math.max(
    DEFAULT_RETENTION_DAYS,
    ...[...retentionByUser.values()].filter((d) => d > 0),
  );
  const oldest = new Date(Date.now() - longest * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await db
    .from('media')
    .select('id, user_id, created_at')
    .lt('created_at', oldest)
    .limit(PER_RUN);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let removed = 0;
  let files = 0;
  // 消せなかったものは黙って捨てず、応答に出す（cron の戻りを見れば気づける）。
  const failed: string[] = [];

  for (const media of candidates ?? []) {
    const days = retentionByUser.get(media.user_id) ?? DEFAULT_RETENTION_DAYS;
    // 0 は「消さない」。
    if (days <= 0) continue;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    if (new Date(media.created_at).getTime() >= cutoff) continue;

    // 先にファイル、次に行。逆にすると、どのファイルを消せばいいか
    // 分からなくなって Storage に迷子が残る。
    const { data: list } = await db.storage.from('media').list(`${media.user_id}/${media.id}`);
    if (list?.length) {
      const paths = list.map((f) => `${media.user_id}/${media.id}/${f.name}`);
      const { error: removeError } = await db.storage.from('media').remove(paths);
      if (removeError) continue; // 消せなかったものは行を残して次回に回す。
      files += paths.length;
    }

    // media_segments は外部キーの cascade で一緒に消える。
    //
    // ここで失敗すると **Storage のファイルだけ消えて行が残る**。
    // 一覧には残るのに再生できない音声ができあがり、しかも次回以降は
    // list が空なので「消すものが無い」として素通りされ、永久に居座る。
    // 数えないだけでなく、気づけるように残す。
    const { error: deleteError } = await db.from('media').delete().eq('id', media.id);
    if (deleteError) {
      failed.push(`${media.id}: ${deleteError.message}`);
      continue;
    }
    removed++;
  }

  return Response.json({ removed, files, ...(failed.length ? { failed } : {}) });
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;
