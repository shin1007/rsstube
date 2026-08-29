'use server';

import { attempt } from '@/lib/actions/result';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * パスキーの後始末。
 *
 * 登録と検証は Route Handler 側（api/passkeys）にある。ブラウザの
 * `navigator.credentials` を待ってから続きを送る必要があり、Server Action だと
 * 1往復で書けないため。ここに置くのは「一覧から消す」だけ。
 */

export async function deletePasskey(id: string) {
  return attempt(() => deletePasskeyImpl(id));
}

async function deletePasskeyImpl(id: string): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  // 消すのはログイン中のユーザーとして。他人の鍵は RLS が弾く（0034）。
  const { error } = await supabase.from('passkeys').delete().eq('id', id);
  if (error) throw error;

  revalidatePath('/settings');
}
