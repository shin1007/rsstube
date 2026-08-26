import { enqueue } from '@/lib/jobs/queue';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 音声化の受付。
 *
 * ここでやるのは media の行を1つ作って script ジョブを積むところまで。
 * 実際の生成（台本 → 合成）はワーカーが少しずつ進める。押した直後に
 * 待たせない代わりに、状態を status で追えるようにしてある。
 */

export type MediaTarget =
  | { kind: 'article'; articleId: string }
  | { kind: 'digest'; digestId: string };

export type MediaRequest = {
  id: string;
  /** 新しく作ったか。既にあるものを返したときは false。 */
  created: boolean;
  /** 諦めていたものを積み直したか。押した人には「作り直し」と伝える。 */
  retried: boolean;
};

export async function requestMedia(
  db: SupabaseClient,
  userId: string,
  target: MediaTarget,
  title: string,
): Promise<MediaRequest> {
  // 設定を**この時点で写して** media に焼く。あとで設定を変えても、
  // 作り始めたものの形は変わらない（対話の台本を1人の声で読む、といった
  // 食い違いを防ぐ）。行が無いときの既定は対話。
  const { data: settings } = await db
    .from('settings')
    .select('voice_mode')
    .eq('user_id', userId)
    .maybeSingle();

  const row = {
    user_id: userId,
    kind: target.kind,
    article_id: target.kind === 'article' ? target.articleId : null,
    digest_id: target.kind === 'digest' ? target.digestId : null,
    title,
    status: 'queued' as const,
    voice_mode: settings?.voice_mode === 'solo' ? 'solo' : 'dialogue',
  };

  // 同じ対象を二重に音声化しない（0010 の一意制約）。既にあるならそれを返す。
  const { data: existing } = await db
    .from('media')
    .select('id, status')
    .eq('user_id', userId)
    .eq('kind', target.kind)
    .eq(target.kind === 'article' ? 'article_id' : 'digest_id',
        target.kind === 'article' ? target.articleId : target.digestId)
    .maybeSingle();

  if (existing) {
    // **諦めたものは押し直しで作り直せること。** 一意索引があるので、ここで
    // status を見ずに返すと failed の行が居座り、「既に作ってあります」しか
    // 出なくなって二度と作れない（実際に1本が生成中のまま8日残った）。
    if (existing.status === 'failed') {
      await retryMedia(existing.id);
      return { id: existing.id, created: false, retried: true };
    }
    return { id: existing.id, created: false, retried: false };
  }

  const { data, error } = await db.from('media').insert(row).select('id').single();
  if (error) throw error;

  // ジョブは**必ず Secret キーで積む**。jobs は 0005 で RLS のポリシーを全部
  // 落としてある（ユーザーに他人のジョブを見せない・作らせないため）ので、
  // ログイン中のユーザーとして insert すると 42501 で必ず弾かれる。
  // ここを user のクライアントで叩いていたせいで、media の行だけができて
  // script ジョブが積まれず、「音声にする」が毎回失敗していた。
  try {
    await enqueue(createAdminClient(), 'script', { media_id: data.id }, userId);
  } catch (e) {
    // ジョブが無い media は永久に queued のまま残り、一意索引のせいで
    // 押し直しても「既に作ってあります」になって二度と作れなくなる。
    // 積めなかったら行ごと引き取る（次に押せば作り直せる）。
    await db.from('media').delete().eq('id', data.id);
    throw e;
  }

  return { id: data.id, created: true, retried: false };
}

/** retry_media が返す「どこから再開したか」。 */
export type RetryFrom = 'script' | 'tts' | 'ready' | 'missing';

/**
 * 諦めた音声を積み直す（`0027` の retry_media）。
 *
 * **できているセグメントは作り直さない。** 台本づくり（gemini-3.5-flash）は
 * 1日20回しか叩けないので、詰まった原因が枠切れだったときに全部やり直すと
 * 同じ枠切れをもう一度踏む。諦めたジョブは payload がそのまま使えるので、
 * 積み直すのではなく status を戻すだけで済む。
 *
 * **必ず Secret キーで叩く。** 中で jobs を触るが、jobs には 0005 以降
 * RLS のポリシーが1つも無いので、ログイン中のユーザーのクライアントからだと
 * 42501 で必ず弾かれる。持ち主かどうかは呼ぶ前に見ておくこと。
 */
export async function retryMedia(mediaId: string): Promise<RetryFrom> {
  const { data, error } = await createAdminClient().rpc('retry_media', { target: mediaId });
  if (error) throw error;
  return (data as RetryFrom) ?? 'missing';
}
