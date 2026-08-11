'use server';

import { fetchFeed } from '@/lib/feeds/parse';
import { parseOpml } from '@/lib/feeds/opml';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/** フィードとフォルダの管理。 */

async function client() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('未ログインです');
  return { supabase, userId: data.user.id };
}

/** フォルダ名からIDを引く。無ければ作る。OPML取り込みで使う。 */
async function folderId(
  supabase: Awaited<ReturnType<typeof client>>['supabase'],
  userId: string,
  name: string | undefined,
): Promise<string | null> {
  if (!name) return null;
  const { data: existing } = await supabase
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('folders')
    .insert({ user_id: userId, name })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

export async function addFeed(formData: FormData) {
  const url = String(formData.get('url') ?? '').trim();
  const folder = String(formData.get('folder') ?? '').trim() || undefined;
  if (!url) return;

  const { supabase, userId } = await client();

  // 登録前に一度取得して、フィードとして読めることとタイトルを確認する。
  const result = await fetchFeed(url);
  const title = result.status === 'ok' ? result.title : '';

  const { error } = await supabase.from('feeds').insert({
    user_id: userId,
    url,
    title,
    site_url: result.status === 'ok' ? (result.siteUrl ?? null) : null,
    folder_id: await folderId(supabase, userId, folder),
  });
  if (error && error.code !== '23505') throw error;

  revalidatePath('/settings');
  revalidatePath('/');
}

export async function deleteFeed(feedId: string) {
  const { supabase } = await client();
  const { error } = await supabase.from('feeds').delete().eq('id', feedId);
  if (error) throw error;
  revalidatePath('/settings');
  revalidatePath('/');
}

/**
 * OPML取り込み。
 * 取り込み時点ではフィードの中身を取りに行かない（数百件あると時間切れになる）。
 * タイトルと記事は、次の巡回で埋まる。
 */
export async function importOpml(formData: FormData) {
  const file = formData.get('opml');
  if (!(file instanceof File) || file.size === 0) return;

  const { supabase, userId } = await client();
  const feeds = parseOpml(await file.text());

  // フォルダ名 → ID を先にまとめて解決する。
  const folderIds = new Map<string, string | null>();
  for (const name of new Set(feeds.map((f) => f.folder).filter(Boolean) as string[])) {
    folderIds.set(name, await folderId(supabase, userId, name));
  }

  const rows = feeds.map((f) => ({
    user_id: userId,
    url: f.xmlUrl,
    title: f.title,
    site_url: f.htmlUrl ?? null,
    folder_id: f.folder ? (folderIds.get(f.folder) ?? null) : null,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('feeds')
      .upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true });
    if (error) throw error;
  }

  revalidatePath('/settings');
  revalidatePath('/');
}
