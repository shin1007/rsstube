import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ジョブキュー。
 *
 * Gemini の無料枠にはレート制限があるので、記事が大量に入ってきても
 * 一気に処理せず、ワーカーが5分毎に少しずつ食べていく形にする。
 * 排他とバックオフの実体は 0002_jobs_rpc.sql の RPC 側にある。
 */

export type JobType = 'extract' | 'summarize' | 'digest' | 'script' | 'tts';

export type Job = {
  id: number;
  user_id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
};

export async function enqueue(
  db: SupabaseClient,
  userId: string,
  type: JobType,
  payload: Record<string, unknown>,
): Promise<void> {
  // 同じ対象の未処理ジョブがあれば一意索引で弾かれる。重複は無視してよい。
  const { error } = await db.from('jobs').insert({ user_id: userId, type, payload });
  if (error && error.code !== '23505') throw error;
}

export async function enqueueMany(
  db: SupabaseClient,
  userId: string,
  type: JobType,
  payloads: Record<string, unknown>[],
): Promise<void> {
  if (payloads.length === 0) return;
  const rows = payloads.map((payload) => ({ user_id: userId, type, payload }));
  const { error } = await db.from('jobs').insert(rows);
  if (error && error.code !== '23505') throw error;
}

export async function claim(
  db: SupabaseClient,
  limit: number,
  type?: JobType,
): Promise<Job[]> {
  const { data, error } = await db.rpc('claim_jobs', {
    job_limit: limit,
    job_type: type ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Job[];
}

export async function complete(db: SupabaseClient, jobId: number): Promise<void> {
  const { error } = await db.rpc('complete_job', { job_id: jobId });
  if (error) throw error;
}

export async function fail(db: SupabaseClient, jobId: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const { error } = await db.rpc('fail_job', { job_id: jobId, err: message.slice(0, 1000) });
  if (error) throw error;
}
