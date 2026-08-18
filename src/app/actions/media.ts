'use server';

import { requestMedia, type MediaTarget } from '@/lib/media/create';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 音声化の受付。
 *
 * 押した時点では何もできていない。ワーカーが台本 → 合成の順に少しずつ進めるので、
 * 戻り値は「どこで進み具合を見られるか」だけ返す。
 *
 * 失敗を throw で返さないのは、**本番では Server Action の例外が握り潰される**ため。
 * Next は投げられたエラーを digest に置き換えてしまうので、クライアントには
 * 「Minified React error #441」（＝中身を伏せた Server Components のエラー）しか
 * 届かず、'記事が見つかりません' のような文面は本番で一度も表に出ない。
 * 見せたい文面は値として返すこと。
 */

export type MediaRequestResult =
  | { ok: true; id: string; created: boolean; message: string }
  | { ok: false; message: string };

export async function requestArticleMedia(articleId: string): Promise<MediaRequestResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: '未ログインです' };

  const { data: article } = await supabase
    .from('articles')
    .select('title')
    .eq('id', articleId)
    .maybeSingle();
  if (!article) return { ok: false, message: '記事が見つかりません' };

  return run(supabase, auth.user.id, { kind: 'article', articleId }, article.title);
}

export async function requestDigestMedia(digestId: string): Promise<MediaRequestResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: '未ログインです' };

  const { data: digest } = await supabase
    .from('digests')
    .select('date')
    .eq('id', digestId)
    .maybeSingle();
  if (!digest) return { ok: false, message: 'ダイジェストが見つかりません' };

  return run(supabase, auth.user.id, { kind: 'digest', digestId }, `ダイジェスト ${digest.date}`);
}

async function run(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  target: MediaTarget,
  title: string,
): Promise<MediaRequestResult> {
  let id: string;
  let created: boolean;
  try {
    ({ id, created } = await requestMedia(supabase, userId, target, title));
  } catch (e) {
    // 中身はサーバーのログに残す。表に出すのは短い一文だけ。
    console.error('requestMedia failed', e);
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `音声化を受け付けられませんでした: ${detail}` };
  }

  revalidatePath('/listen');
  revalidatePath('/exports');

  return {
    ok: true,
    id,
    created,
    message: created
      ? '音声化をキューに入れました。数分後に「聴く」に出ます。'
      : '既に作ってあります。「聴く」から開けます。',
  };
}
