import { enqueue } from '@/lib/jobs/queue';
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

export async function requestMedia(
  db: SupabaseClient,
  userId: string,
  target: MediaTarget,
  title: string,
): Promise<{ id: string; created: boolean }> {
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

  if (existing) return { id: existing.id, created: false };

  const { data, error } = await db.from('media').insert(row).select('id').single();
  if (error) throw error;

  await enqueue(db, 'script', { media_id: data.id }, userId);

  return { id: data.id, created: true };
}
