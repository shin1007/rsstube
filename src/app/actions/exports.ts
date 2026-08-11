'use server';

import { buildMarkdown, type ExportArticle } from '@/lib/export/markdown';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 記事を NotebookLM 用の Markdown にまとめて保存する。
 *
 * 実際の音声化は NotebookLM 側でやるので、ここでの仕事は
 * 「投入できる形にして渡す」ことだけ。
 */

type Raw = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string | null;
  content_text: string | null;
  content_ok: boolean;
  feeds: { title: string } | null;
  summaries: { bullets: string[] } | null;
};

export type ExportResult = {
  id: string;
  title: string;
  markdown: string;
  prompt: string;
};

export async function createExport(
  articleIds: string[],
  kind: 'manual' | 'digest' = 'manual',
  title?: string,
): Promise<ExportResult> {
  if (articleIds.length === 0) throw new Error('記事が選択されていません');

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');
  const userId = auth.user.id;

  const { data, error } = await supabase
    .from('articles')
    .select(
      `id, title, url, author, published_at, content_text, content_ok,
       feeds (title), summaries (bullets)`,
    )
    .in('id', articleIds);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Raw[];
  // 選択した順を保つ（一覧で見ていた並びのまま音声になるほうが自然）。
  const order = new Map(articleIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const articles: ExportArticle[] = rows.map((r) => ({
    title: r.title,
    url: r.url,
    feedTitle: r.feeds?.title ?? null,
    author: r.author,
    publishedAt: r.published_at,
    bullets: r.summaries?.bullets ?? null,
    contentText: r.content_text,
    contentOk: r.content_ok,
  }));

  const finalTitle =
    title ??
    (rows.length === 1
      ? rows[0].title
      : `RSSTube ${new Date().toLocaleDateString('ja-JP')}`);

  const markdown = buildMarkdown(articles, finalTitle);

  const { data: settings } = await supabase
    .from('settings')
    .select('notebooklm_prompt')
    .eq('user_id', userId)
    .maybeSingle();

  const prompt = settings?.notebooklm_prompt ?? '';

  const { data: saved, error: saveError } = await supabase
    .from('exports')
    .insert({
      user_id: userId,
      kind,
      title: finalTitle,
      markdown,
      prompt,
      article_ids: rows.map((r) => r.id),
    })
    .select('id')
    .single();
  if (saveError) throw saveError;

  // 送信済みの印を付けて、次回まとめて出すときに重複しないようにする。
  const now = new Date().toISOString();
  await supabase.from('article_states').upsert(
    rows.map((r) => ({
      article_id: r.id,
      user_id: userId,
      exported_at: now,
      updated_at: now,
    })),
    { onConflict: 'article_id' },
  );

  revalidatePath('/');
  revalidatePath('/exports');

  return { id: saved.id, title: finalTitle, markdown, prompt };
}

/** 「あとで」に溜めた記事をまとめて書き出す。 */
export async function exportReadLater(): Promise<ExportResult> {
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

  return createExport(ids, 'manual');
}
