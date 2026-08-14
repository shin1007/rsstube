import { listSubscribedFeeds } from '@/lib/subscriptions';
import {
  createFolder,
  importOpml,
  moveFolder,
  renameFolder,
} from '@/app/actions/feeds';
import { signOut } from '@/app/actions/articles';
import { AddFeed } from '@/components/AddFeed';
import { DeleteFolderButton } from '@/components/DeleteFolderButton';
import { DriveConnect } from '@/components/DriveConnect';
import { FeedHealth } from '@/components/FeedHealth';
import { UnsubscribeButton } from '@/components/UnsubscribeButton';
import { FolderSelect } from '@/components/FolderSelect';
import { PushToggle } from '@/components/PushToggle';
import { UsageTable } from '@/components/UsageTable';
import { recentUsage } from '@/lib/ai/usage';
import { pipelineStatus } from '@/lib/pipeline';
import { getDriveStatus } from '@/app/actions/drive';
import { DEFAULT_NOTEBOOKLM_PROMPT } from '@/lib/export/prompt';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { FeedRow, FolderRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const supabase = await createClient();
  // OAuth から戻ってきたときの結果（?drive=connected など）。
  const notice = typeof (await searchParams).drive === 'string'
    ? ((await searchParams).drive as string)
    : undefined;

  const [feeds, { data: folders }, { data: settings }, usage, pipeline, drive] = await Promise.all([
    listSubscribedFeeds(),
    // 並び順はサイドバーと揃える（sort_order → 名前）。
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
    supabase.from('settings').select('*').maybeSingle(),
    recentUsage(),
    pipelineStatus(),
    getDriveStatus(),
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
        retention_days: Number(formData.get('retention_days') ?? 90),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
    revalidatePath('/settings');
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-8 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400">
            ← 一覧
          </Link>
          <h1 className="text-xl font-bold">設定</h1>
          {/* スマホには下部タブしか無いので、二次画面どうしを相互に張っておく。 */}
          <Link href="/library" className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">
            アーカイブ
          </Link>
          <Link href="/exports" className="text-xs text-zinc-500 hover:text-zinc-200">
            書き出し
          </Link>
          <Link href="/account/password" className="text-xs text-zinc-500 hover:text-zinc-200">
            パスワード
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-200">
              ログアウト
            </button>
          </form>
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
              // 未保存（settings の行がまだ無い）ときも、実際に使われる文面を出す。
              defaultValue={settings?.notebooklm_prompt ?? DEFAULT_NOTEBOOKLM_PROMPT}
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
              <label className="text-xs text-zinc-400" title="0で無効（本文を永久に保持）">
                本文の保持
                <input
                  type="number"
                  name="retention_days"
                  min={0}
                  max={3650}
                  defaultValue={settings?.retention_days ?? 90}
                  className="ml-2 w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                />
                日
              </label>
            </div>
            <p className="text-xs text-zinc-500">
              保持期間を過ぎた既読記事は本文だけを消します（スター・あとで・書き出し済みは対象外）。
              記事の行自体は残るので、既読の記事が未読で戻ってくることはありません。0 で無効。
            </p>
            <button type="submit" className="rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900">
              保存
            </button>
          </form>
        </section>

        {/* ---------------- 取り込みの進み具合 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">取り込みの進み具合</h2>
          <p className="mb-2 text-xs text-zinc-500">
            記事は「本文を取りに行く → 要約する」の順に処理されます。フィードを増やした
            直後はここに溜まりますが、5分ごとに少しずつ減っていきます。
          </p>
          <ul className="space-y-1 text-xs">
            <li className="text-zinc-400">
              本文の順番待ち: <span className="text-zinc-200">{pipeline.pendingExtract}件</span>
              <span className="ml-1 text-zinc-600">（待てば減ります）</span>
            </li>
            <li className="text-zinc-400">
              要約の順番待ち: <span className="text-zinc-200">{pipeline.pendingSummary}件</span>
            </li>
            <li className={pipeline.failedExtract > 0 ? 'text-amber-500' : 'text-zinc-400'}>
              本文を取れなかった記事: {pipeline.failedExtract}件
              <span className="ml-1 text-zinc-600">
                （ペイウォールやアクセス制限。RSSの抜粋から要約します）
              </span>
            </li>
          </ul>
        </section>

        {/* ---------------- 使用量 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">AI の使用量（直近7日）</h2>
          <UsageTable usage={usage} />
        </section>

        {/* ---------------- 通知 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Google Drive</h2>
          <p className="mb-2 text-xs text-zinc-500">
            書き出した Markdown を Google Docs として Drive に置けます。NotebookLM は
            ドライブ上のファイルを直接ソースに選べるので、ダウンロードして
            アップロードし直す手間が要らなくなります。
            <br />
            権限は<strong className="text-zinc-400">このアプリが作ったファイルだけ</strong>
            （drive.file）。既存のドライブの中身は読みません。
          </p>
          <DriveConnect connected={drive.connected} email={drive.email} notice={notice} />
        </section>

        {/* ---------------- 通知 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">ダイジェストの通知</h2>
          <p className="mb-2 text-xs text-zinc-500">
            朝のダイジェストができたときに通知します。アプリを開いていなくても届くので、
            これが「起きたら聴く」の起点になります。端末ごとに登録が要ります。
          </p>
          {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? (
            <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
          ) : (
            <p className="text-xs text-zinc-500">
              VAPID の鍵が設定されていません。<code>npm run vapid</code> で作って
              <code className="mx-1">.env.local</code>に入れてください。
            </p>
          )}
        </section>

        {/* ---------------- 手当てが要るフィード（何も無ければ出ない） ---------------- */}
        <FeedHealth feeds={feeds} />

        {/* ---------------- フィード追加 ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">フィードを追加</h2>
          <AddFeed folders={(folders ?? []) as FolderRow[]} />
        </section>

        {/* ---------------- OPML ---------------- */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">OPML を取り込む</h2>
            <a
              href="/api/opml"
              download
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100"
            >
              書き出す
            </a>
          </div>
          <p className="mb-2 text-xs text-zinc-500">
            Inoreader / Feedly からエクスポートした OPML をそのまま読み込めます。
            記事は次の巡回で入ります。「書き出す」で今の購読一覧を OPML として保存できます
            （バックアップ用。フォルダの構成も一緒に出ます）。
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

        {/* ---------------- フォルダ ---------------- */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">フォルダ（{(folders ?? []).length}）</h2>
          <p className="mb-2 text-xs text-zinc-500">
            並び順はサイドバーにそのまま反映されます。名前を書き換えて Enter で保存。
            フォルダを削除しても中のフィードは残り、未分類に移ります。
          </p>

          <ul className="mb-2 divide-y divide-zinc-900 rounded border border-zinc-800">
            {(folders ?? []).map((f: FolderRow, i: number) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <form action={renameFolder.bind(null, f.id)} className="min-w-0 flex-1">
                  <input
                    type="text"
                    name="name"
                    defaultValue={f.name}
                    aria-label="フォルダ名"
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-zinc-800 focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none"
                  />
                </form>
                <form action={moveFolder.bind(null, f.id, 'up')}>
                  <button
                    type="submit"
                    disabled={i === 0}
                    aria-label="上へ"
                    className="px-1 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-25"
                  >
                    ↑
                  </button>
                </form>
                <form action={moveFolder.bind(null, f.id, 'down')}>
                  <button
                    type="submit"
                    disabled={i === (folders ?? []).length - 1}
                    aria-label="下へ"
                    className="px-1 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-25"
                  >
                    ↓
                  </button>
                </form>
                <DeleteFolderButton
                  id={f.id}
                  name={f.name}
                  feedCount={(feeds ?? []).filter((feed: FeedRow) => feed.folder_id === f.id).length}
                />
              </li>
            ))}
            {(folders ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-zinc-500">
                まだフォルダがありません
              </li>
            )}
          </ul>

          <form action={createFolder} className="flex gap-2">
            <input
              type="text"
              name="name"
              required
              placeholder="新しいフォルダ名"
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
              追加
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
              <li key={feed.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{feed.title || feed.url}</p>
                  <p className="truncate text-xs text-zinc-600">{feed.url}</p>
                  {feed.error_count > 0 && (
                    <p className="truncate text-xs text-amber-500">
                      取得失敗 {feed.error_count}回: {feed.last_error}
                    </p>
                  )}
                </div>
                <FolderSelect
                  feedId={feed.id}
                  folders={(folders ?? []) as FolderRow[]}
                  current={feed.folder_id}
                />
                <UnsubscribeButton
                  feedId={feed.id}
                  title={feed.title || feed.url}
                  folderId={feed.folder_id}
                />
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
