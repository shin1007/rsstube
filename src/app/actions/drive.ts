'use server';

import { attempt } from '@/lib/actions/result';

import { driveStatus, uploadToDrive } from '@/lib/export/drive';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/** Google Drive への書き出しと、接続の管理。 */

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('未ログインです');
  return { supabase, userId: data.user.id };
}

export async function getDriveStatus() {
  const { userId } = await me();
  return driveStatus(userId);
}

export async function disconnectDrive() {
  return attempt(() => disconnectDriveImpl());
}

async function disconnectDriveImpl() {
  const { userId } = await me();
  // トークンの行は Secret キーからしか触れない（0017）。
  const db = createAdminClient();
  const { error } = await db.from('google_accounts').delete().eq('user_id', userId);
  if (error) throw error;
  revalidatePath('/settings');
}

/**
 * 保存済みの書き出しを Drive に置く。
 *
 * 置いた先は exports に控える。同じものを二度置かないためと、
 * あとから「あれはどこに置いたか」を辿れるようにするため。
 */
export async function exportToDrive(exportId: string) {
  return attempt(() => exportToDriveImpl(exportId));
}

async function exportToDriveImpl(exportId: string): Promise<{ url: string; name: string }> {
  const { supabase, userId } = await me();

  const { data: row, error } = await supabase
    .from('exports')
    .select('id, title, markdown, drive_url')
    .eq('id', exportId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('書き出しが見つかりません');

  const file = await uploadToDrive(userId, row.title, row.markdown);

  await supabase
    .from('exports')
    .update({ drive_file_id: file.id, drive_url: file.url })
    .eq('id', exportId);

  revalidatePath('/exports');
  return { url: file.url, name: file.name };
}
