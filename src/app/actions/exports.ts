'use server';

import { attempt } from '@/lib/actions/result';

import { createExportFor, type ExportResult } from '@/lib/export/create';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 記事を NotebookLM 用の Markdown にまとめて保存する（画面からの入口）。
 *
 * 実際の音声化は NotebookLM 側でやるので、ここでの仕事は
 * 「投入できる形にして渡す」ことだけ。まとめ方そのものは
 * lib/export/create.ts にあり、毎朝ダイジェストの cron と共有している。
 */

export type { ExportResult };

export async function createExport(
  articleIds: string[],
  kind: 'manual' | 'digest' = 'manual',
  title?: string,
) {
  return attempt(() => createExportImpl(articleIds, kind, title));
}

async function createExportImpl(
  articleIds: string[],
  kind: 'manual' | 'digest' = 'manual',
  title?: string,
): Promise<ExportResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const result = await createExportFor(supabase, auth.user.id, articleIds, kind, title);

  revalidatePath('/');
  revalidatePath('/exports');

  return result;
}

/**
 * 保存済みの書き出しを1件読み直す。
 *
 * 一覧（/exports）は見出しだけを出し、Markdown 本文はここで開いたときに取る。
 * 1件で数十KB〜数百KBになるので、一覧に全部載せると転送量が跳ね上がる。
 */
export async function getExport(id: string) {
  return attempt(() => getExportImpl(id));
}

async function getExportImpl(id: string): Promise<ExportResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exports')
    .select('id, title, markdown, prompt')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('書き出しが見つかりません');
  return data as ExportResult;
}

/** 「あとで」に溜めた記事をまとめて書き出す。 */
export async function exportReadLater() {
  return attempt(() => exportReadLaterImpl());
}

async function exportReadLaterImpl(): Promise<ExportResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const { data, error } = await supabase
    .from('article_states')
    .select('article_id')
    .eq('user_id', auth.user.id)
    .eq('read_later', true)
    // 一度書き出したものは含めない。
    .is('exported_at', null)
    .limit(8);
  if (error) throw error;

  const ids = (data ?? []).map((r) => r.article_id);
  if (ids.length === 0) throw new Error('書き出せる「あとで」の記事がありません');

  // 内側では包まない版を呼ぶ。ここで ActionResult を返すと二重に包まれる。
  return createExportImpl(ids, 'manual');
}
