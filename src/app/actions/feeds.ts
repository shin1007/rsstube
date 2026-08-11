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

export async function createFolder(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const { supabase, userId } = await client();
  // 末尾に置く。既存が全部 0 でも 1 以上になるので順序は壊れない。
  const { data: last } = await supabase
    .from('folders')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from('folders')
    .insert({ user_id: userId, name, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error && error.code !== '23505') throw error; // 同名は一意制約で弾かれる

  revalidatePath('/settings');
  revalidatePath('/');
}

export async function renameFolder(id: string, formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const { supabase } = await client();
  const { error } = await supabase.from('folders').update({ name }).eq('id', id);
  if (error && error.code !== '23505') throw error;

  revalidatePath('/settings');
  revalidatePath('/');
}

/** フォルダだけ消す。中のフィードは feeds.folder_id が null になって未分類に残る。 */
export async function deleteFolder(id: string) {
  const { supabase } = await client();
  const { error } = await supabase.from('folders').delete().eq('id', id);
  if (error) throw error;
  revalidatePath('/settings');
  revalidatePath('/');
}

/**
 * フォルダの並べ替え。
 * 既存データは sort_order が全部 0 のことがあるので、隣と値を交換するのではなく
 * 現在の表示順どおりに 0..n-1 を振り直してから入れ替える。
 */
export async function moveFolder(id: string, direction: 'up' | 'down') {
  const { supabase, userId } = await client();

  const { data: folders } = await supabase
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .order('sort_order')
    .order('name');

  const ordered = folders ?? [];
  const i = ordered.findIndex((f) => f.id === id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordered.length) return;

  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];

  for (const [index, folder] of ordered.entries()) {
    const { error } = await supabase
      .from('folders')
      .update({ sort_order: index })
      .eq('id', folder.id);
    if (error) throw error;
  }

  revalidatePath('/settings');
  revalidatePath('/');
}

/** フィードのフォルダを移す。空文字なら未分類に戻す。 */
export async function moveFeed(feedId: string, formData: FormData) {
  const raw = String(formData.get('folder_id') ?? '').trim();

  const { supabase } = await client();
  const { error } = await supabase
    .from('feeds')
    .update({ folder_id: raw || null })
    .eq('id', feedId);
  if (error) throw error;

  revalidatePath('/settings');
  revalidatePath('/');
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
