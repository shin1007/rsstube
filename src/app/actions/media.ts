'use server';

import { requestMedia, type MediaTarget } from '@/lib/media/create';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 音声化の受付。
 *
 * 押した時点では何もできていない。ワーカーが台本 → 合成の順に少しずつ進めるので、
 * 戻り値は「どこで進み具合を見られるか」だけ返す。
 */

export type MediaRequestResult = {
  id: string;
  created: boolean;
  message: string;
};

export async function requestArticleMedia(articleId: string): Promise<MediaRequestResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const { data: article } = await supabase
    .from('articles')
    .select('title')
    .eq('id', articleId)
    .maybeSingle();
  if (!article) throw new Error('記事が見つかりません');

  return run(supabase, auth.user.id, { kind: 'article', articleId }, article.title);
}

export async function requestDigestMedia(digestId: string): Promise<MediaRequestResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const { data: digest } = await supabase
    .from('digests')
    .select('date')
    .eq('id', digestId)
    .maybeSingle();
  if (!digest) throw new Error('ダイジェストが見つかりません');

  return run(supabase, auth.user.id, { kind: 'digest', digestId }, `ダイジェスト ${digest.date}`);
}

async function run(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  target: MediaTarget,
  title: string,
): Promise<MediaRequestResult> {
  const { id, created } = await requestMedia(supabase, userId, target, title);

  revalidatePath('/listen');
  revalidatePath('/exports');

  return {
    id,
    created,
    message: created
      ? '音声化をキューに入れました。数分後に「聴く」に出ます。'
      : '既に作ってあります。「聴く」から開けます。',
  };
}
