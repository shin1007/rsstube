'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 記事の状態変更。
 *
 * Server Function は UI を経由せず直接 POST できてしまうので、
 * どの関数でも必ずログイン確認をしてから書き込む。
 * 実データの保護は RLS（user_id = auth.uid()）が担保している。
 */

async function client() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('未ログインです');
  return { supabase, userId: data.user.id };
}

async function setState(
  articleId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { supabase, userId } = await client();
  const { error } = await supabase
    .from('article_states')
    .upsert(
      { article_id: articleId, user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'article_id' },
    );
  if (error) throw error;
  revalidatePath('/');
}

export async function markRead(articleId: string, read = true) {
  await setState(articleId, { is_read: read, read_at: read ? new Date().toISOString() : null });
}

export async function setStarred(articleId: string, starred: boolean) {
  await setState(articleId, { is_starred: starred });
}

export async function setReadLater(articleId: string, later: boolean) {
  await setState(articleId, { read_later: later });
}

/** 表示中の記事をまとめて既読にする（Inoreader の "Mark all as read" 相当）。 */
export async function markAllRead(articleIds: string[]) {
  if (articleIds.length === 0) return;
  const { supabase, userId } = await client();

  const now = new Date().toISOString();
  const { error } = await supabase.from('article_states').upsert(
    articleIds.map((id) => ({
      article_id: id,
      user_id: userId,
      is_read: true,
      read_at: now,
      updated_at: now,
    })),
    { onConflict: 'article_id' },
  );
  if (error) throw error;
  revalidatePath('/');
}

/** 要約が無い記事、または要約をやり直したい記事をキューに積む。 */
export async function requestSummary(articleId: string) {
  const { supabase, userId } = await client();
  const { error } = await supabase
    .from('jobs')
    .insert({ user_id: userId, type: 'extract', payload: { article_id: articleId } });
  // 同じ記事の未処理ジョブが既にあるだけなので、重複エラーは無視してよい。
  if (error && error.code !== '23505') throw error;
  revalidatePath('/');
}
