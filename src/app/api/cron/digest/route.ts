import { pickDigestArticles, type DigestCandidate } from '@/lib/digest/select';
import { createExportFor } from '@/lib/export/create';
import { authorizeCron, createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 毎朝ダイジェスト。過去24時間の未読から重要度上位を選び、
 * NotebookLM にそのまま入れられる Markdown を1本作っておく。
 *
 * pg_cron から1時間毎に叩かれ、各ユーザーの settings.digest_hour（日本時間）に
 * 一致した回だけ実際に作る。Vercel Hobby の cron は1日1回・時刻が±59分ずれるので、
 * 「6時のダイジェストが7時半にできる」を避けるためにこちらも pg_cron 側に寄せた。
 *
 * 同じ日に二重に作らないのは digests の unique (user_id, date) で担保する。
 * 手で確かめたいときは:
 *   ?force=1  生成時刻を待たずに作る（当日ぶんが既にあれば作らない）
 *   ?dry=1    選抜だけして何も書かない（選ばれた記事のタイトルを返す）
 * 選抜は音声の中身をそのまま決めるので、まず dry で覗けるようにしてある。
 *
 * force が「当日ぶんが既にある」まで無視しないのは、書き出した記事に
 * exported_at が付いて選抜から外れるため。作り直したつもりで叩くと、
 * 中身の違う2本目ができて1本目が宙に浮く。作り直したいときは
 * digests の当日行を消してから叩くこと。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 選抜の母数。ここから重要度順に digest_count 件へ絞る。 */
const CANDIDATE_LIMIT = 200;
/** 生成時刻の既定値（settings 行がまだ無いユーザー）。 */
const DEFAULT_HOUR = 6;
const DEFAULT_COUNT = 8;

/** ダイジェストは生活時間に紐づくので、UTC ではなく日本時間で判定する。 */
const TIME_ZONE = 'Asia/Tokyo';

/** 選抜に使う項目＋下見で出すタイトル。 */
type Candidate = DigestCandidate & { title: string };

type Result = {
  userId: string;
  status: 'created' | 'skipped';
  /** skipped の理由。created のときは無い。 */
  reason?: 'not-the-hour' | 'already-done' | 'no-articles';
  exportId?: string;
  articles?: number;
  /** dry=1 のときだけ。選ばれた記事の中身を目で見るため。 */
  preview?: { title: string; importance: number | null; folder: string | null }[];
};

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  // dry のときは時刻を待っていても仕方がないので force を兼ねる。
  const force = dry || params.get('force') === '1';
  const db = createAdminClient();
  const now = new Date();
  const hour = hourIn(now, TIME_ZONE);
  const date = dateIn(now, TIME_ZONE);

  // 購読しているユーザーだけが対象。settings 行はまだ無いこともあるので
  // subscriptions を起点にして、設定は後から突き合わせる。
  const { data: subs, error } = await db.from('subscriptions').select('user_id, feed_id, folder_id');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((subs ?? []).map((s) => s.user_id as string))];
  if (userIds.length === 0) return Response.json({ date, hour, results: [] });

  const { data: settings } = await db
    .from('settings')
    .select('user_id, digest_hour, digest_count')
    .in('user_id', userIds);

  const settingsByUser = new Map(
    (settings ?? []).map((s) => [s.user_id as string, s as { digest_hour: number; digest_count: number }]),
  );

  const results: Result[] = [];

  for (const userId of userIds) {
    const setting = settingsByUser.get(userId);
    const wantHour = setting?.digest_hour ?? DEFAULT_HOUR;
    const count = setting?.digest_count ?? DEFAULT_COUNT;

    if (!force && hour !== wantHour) {
      results.push({ userId, status: 'skipped', reason: 'not-the-hour' });
      continue;
    }

    // 同じ日のぶんがもうあるなら何もしない（cron の再実行・手動実行で重複しない）。
    // dry は書かないので素通しでよい。
    if (!dry) {
      const { data: existing } = await db
        .from('digests')
        .select('id')
        .eq('user_id', userId)
        .eq('date', date)
        .maybeSingle();
      if (existing) {
        results.push({ userId, status: 'skipped', reason: 'already-done' });
        continue;
      }
    }

    // フォルダは購読ごとの持ち物（0005）。偏りを避ける判定に使う。
    const folderByFeed = new Map<string, string | null>(
      (subs ?? [])
        .filter((s) => s.user_id === userId)
        .map((s) => [s.feed_id as string, (s.folder_id as string | null) ?? null]),
    );

    const candidates = await loadCandidates(db, userId, folderByFeed);
    const picked = pickDigestArticles(candidates, count);

    if (picked.length === 0) {
      results.push({ userId, status: 'skipped', reason: 'no-articles' });
      continue;
    }

    if (dry) {
      const folderNames = await loadFolderNames(db, userId);
      results.push({
        userId,
        status: 'skipped',
        articles: picked.length,
        preview: picked.map((c) => ({
          title: c.title,
          importance: c.importance,
          folder: c.folderId ? (folderNames.get(c.folderId) ?? null) : null,
        })),
      });
      continue;
    }

    const exported = await createExportFor(
      db,
      userId,
      picked.map((c) => c.id),
      'digest',
      `RSSTube ダイジェスト ${date}`,
    );

    // 当日ぶんの目印。unique (user_id, date) が二重生成の最後の砦になる。
    const { error: digestError } = await db.from('digests').insert({
      user_id: userId,
      date,
      export_id: exported.id,
      article_ids: picked.map((c) => c.id),
    });
    if (digestError) throw digestError;

    results.push({
      userId,
      status: 'created',
      exportId: exported.id,
      articles: picked.length,
    });
  }

  return Response.json({ date, hour, results });
}

/** ブラウザから手で叩いて確認できるように GET でも同じ処理を通す。 */
export const GET = POST;

/**
 * 過去24時間に入った未読記事を集める。
 *
 * 期間は published_at ではなく created_at（こちらに取り込んだ時刻）で見る。
 * 何日も前の日付で流れてくるフィードがあり、published_at だと
 * 「昨日初めて届いた記事」が窓から外れてしまうため。
 */
async function loadCandidates(
  db: SupabaseClient,
  userId: string,
  folderByFeed: Map<string, string | null>,
): Promise<Candidate[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('articles')
    .select(
      `id, title, feed_id, published_at, importance,
       article_states!inner (user_id, is_read, exported_at)`,
    )
    .eq('article_states.user_id', userId)
    .eq('article_states.is_read', false)
    // 手で NotebookLM に投げた記事を朝もう一度出さない。
    .is('article_states.exported_at', null)
    .gte('created_at', since)
    // 並べ替えは埋め込み先ではなく親テーブルの列で（0007 で踏んだ罠）。
    .order('importance', { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_LIMIT);

  if (error) throw error;

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    feed_id: string;
    published_at: string | null;
    importance: number | null;
  }[]).map((r) => ({
    id: r.id,
    title: r.title,
    importance: r.importance,
    folderId: folderByFeed.get(r.feed_id) ?? null,
    publishedAt: r.published_at,
  }));
}

/** dry=1 の下見でフォルダ名を出すためだけの引き当て。 */
async function loadFolderNames(
  db: SupabaseClient,
  userId: string,
): Promise<Map<string, string>> {
  const { data } = await db.from('folders').select('id, name').eq('user_id', userId);
  return new Map((data ?? []).map((f) => [f.id as string, f.name as string]));
}

/**
 * 指定タイムゾーンでの「時」。Intl を使うのは環境の TZ に振り回されないため。
 * hour12:false ではなく hourCycle:'h23' を使うのは、前者だと真夜中が
 * 環境によって "24" になるため。
 */
function hourIn(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
}

/** 指定タイムゾーンでの YYYY-MM-DD。 */
function dateIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
