import { addFeed, deleteFeed, importOpml } from '@/app/actions/feeds';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { FeedRow, FolderRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();

  const [{ data: feeds }, { data: folders }, { data: settings }] = await Promise.all([
    supabase
      .from('feeds')
      .select('id, title, url, site_url, folder_id, error_count, last_error, last_fetched_at')
      .order('title'),
    supabase.from('folders').select('id, name').order('name'),
    supabase.from('settings').select('*').maybeSingle(),
  ]);

  async function saveSettings(formData: FormData) {
    'use server';
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw new Error('未ログインです');

    const { error } = await supabase.from('settings').upsert(
      {
        user_id: data.user.id,
        notebooklm_prompt: String(formData.get('notebooklm_prompt') ?? ''),
        digest_count: Number(formData.get('digest_count') ?? 8),
        digest_hour: Number(formData.get('digest_hour') ?? 6),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
    revalidatePath('/settings');
  }

  const folderName = new Map((folders ?? []).map((f: FolderRow) => [f.id, f.name]));

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-8 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400">
            ← 一覧
          </Link>
          <h1 className="text-xl font-bold">設定</h1>
        </div>

        {/* ---------------- NotebookLM 用の指示文 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">NotebookLM の音声概要の指示文</h2>
          <p className="mb-2 text-xs text-zinc-500">
            書き出しのたびにここの文面がコピーできるようになります。音声の口調・長さ・
            話の焦点はこの指示文でほぼ決まるので、聴きながら調整してください。
          </p>
          <form action={saveSettings} className="space-y-3">
            <textarea
              name="notebooklm_prompt"
              rows={4}
              defaultValue={settings?.notebooklm_prompt ?? ''}
              className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
            <div className="flex gap-3">
              <label className="text-xs text-zinc-400">
                ダイジェスト件数
                <input
                  type="number"
                  name="digest_count"
                  min={1}
                  max={20}
                  defaultValue={settings?.digest_count ?? 8}
                  className="ml-2 w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                生成時刻
                <input
                  type="number"
                  name="digest_hour"
                  min={0}
                  max={23}
                  defaultValue={settings?.digest_hour ?? 6}
                  className="ml-2 w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                />
                時
              </label>
            </div>
            <button type="submit" className="rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900">
              保存
            </button>
          </form>
        </section>

        {/* ---------------- フィード追加 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">フィードを追加</h2>
          <form action={addFeed} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              name="url"
              required
              placeholder="https://example.com/feed.xml"
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <input
              type="text"
              name="folder"
              placeholder="フォルダ名（任意）"
              list="folder-names"
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm sm:w-40"
            />
            <datalist id="folder-names">
              {(folders ?? []).map((f: FolderRow) => (
                <option key={f.id} value={f.name} />
              ))}
            </datalist>
            <button type="submit" className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
              追加
            </button>
          </form>
        </section>

        {/* ---------------- OPML ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">OPML を取り込む</h2>
          <p className="mb-2 text-xs text-zinc-500">
            Inoreader / Feedly からエクスポートした OPML をそのまま読み込めます。
            記事は次の巡回で入ります。
          </p>
          <form action={importOpml} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="file"
              name="opml"
              accept=".opml,.xml,text/xml,application/xml"
              required
              className="flex-1 text-sm text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-zinc-100"
            />
            <button type="submit" className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
              取り込む
            </button>
          </form>
        </section>

        {/* ---------------- 登録済みフィード ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            登録済みフィード（{(feeds ?? []).length}）
          </h2>
          <ul className="divide-y divide-zinc-900 rounded border border-zinc-800">
            {(feeds ?? []).map((feed: FeedRow) => (
              <li key={feed.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{feed.title || feed.url}</p>
                  <p className="truncate text-xs text-zinc-600">
                    {feed.folder_id ? `${folderName.get(feed.folder_id)} / ` : ''}
                    {feed.url}
                  </p>
                  {feed.error_count > 0 && (
                    <p className="truncate text-xs text-amber-500">
                      取得失敗 {feed.error_count}回: {feed.last_error}
                    </p>
                  )}
                </div>
                <form action={deleteFeed.bind(null, feed.id)}>
                  <button type="submit" className="text-xs text-zinc-500 hover:text-red-400">
                    削除
                  </button>
                </form>
              </li>
            ))}
            {(feeds ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-zinc-500">
                まだフィードがありません
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
