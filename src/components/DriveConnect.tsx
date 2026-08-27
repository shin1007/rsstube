'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { disconnectDrive } from '@/app/actions/drive';
import { useState, useTransition } from 'react';

/**
 * Google Drive の接続。
 *
 * 繋ぐのはリダイレクトが要るので普通のリンク。切るのはサーバーアクションで済む。
 * 何が起きるかは押す前に書いておく（このアプリが作ったファイルしか触らないこと）。
 *
 * **押す前に、押せるかどうかを出す。** 環境変数が入っていないときも
 * 「接続する」ボタンは出ていて、押すと同意画面にも行かずに設定画面へ
 * 戻ってくるだけだった（理由は戻ってきて初めて出る）。押しても進まない
 * ボタンは、押せないものとして出す。
 */
export function DriveConnect({
  connected,
  email,
  notice,
  configured = true,
  redirectUri,
  expectedRedirectUri,
}: {
  connected: boolean;
  email?: string;
  notice?: string;
  /** GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI がこの環境に入っているか。 */
  configured?: boolean;
  /** いま設定されている戻り先。秘密ではない（同意画面のURLに載る）。 */
  redirectUri?: string;
  /** いま開いている URL から見た、あるべき戻り先。食い違うときだけ渡ってくる。 */
  expectedRedirectUri?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {notice && (
        <p
          className={`text-xs ${
            notice === 'connected' ? 'text-emerald-400' : 'text-amber-500'
          }`}
        >
          {NOTICES[notice] ?? notice}
        </p>
      )}

      {/*
        未設定のまま押すと、同意画面にも行かずにここへ戻ってくる。
        何をどこに入れればいいかまで書く（本番と手元で別々に要る）。
      */}
      {!connected && !configured && (
        <p className="text-xs text-amber-500">
          この環境に Google の認証情報が入っていません。
          <code className="mx-1 rounded bg-zinc-800 px-1">GOOGLE_CLIENT_ID</code>
          <code className="mr-1 rounded bg-zinc-800 px-1">GOOGLE_CLIENT_SECRET</code>
          <code className="mr-1 rounded bg-zinc-800 px-1">GOOGLE_REDIRECT_URI</code>
          を入れて、デプロイし直してください（本番の Vercel と手元の
          <code className="mx-1 rounded bg-zinc-800 px-1">.env.local</code>
          は別々に要ります）。
        </p>
      )}

      {/*
        向き先が違うと、同意画面まで行ってから Google 側で
        redirect_uri_mismatch になる。こちらのエラーとして戻ってこないので、
        押す前に出しておかないと原因が分からない。
      */}
      {!connected && configured && expectedRedirectUri && (
        <p className="text-xs text-amber-500">
          戻り先の設定が、いま開いている URL と違います。
          <code className="mx-1 rounded bg-zinc-800 px-1">GOOGLE_REDIRECT_URI</code>
          を
          <code className="mx-1 rounded bg-zinc-800 px-1">{expectedRedirectUri}</code>
          にして（いまは <code className="rounded bg-zinc-800 px-1">{redirectUri}</code>）、
          同じ URL を Google Cloud Console の「承認済みのリダイレクト URI」にも
          登録してください。
        </p>
      )}

      {connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-emerald-400">
            接続済み{email ? `（${email}）` : ''}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const r = await disconnectDrive();
                  if (!r.ok) setError(r.message);
                } catch {
                  setError(UNEXPECTED_ERROR);
                }
              });
            }}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            {pending ? '切断中…' : '接続を切る'}
          </button>
        </div>
      ) : configured ? (
        <a
          href="/api/auth/google/start"
          className="inline-block rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900"
        >
          Google Drive に接続
        </a>
      ) : (
        <span
          aria-disabled="true"
          title="環境変数が入っていないので、いまは接続できません"
          className="inline-block cursor-not-allowed rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-600"
        >
          Google Drive に接続
        </span>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

const NOTICES: Record<string, string> = {
  connected: '接続しました。書き出しから Drive に置けます。',
  denied: '許可されなかったので接続できていません。',
  state: '接続の途中で情報が食い違いました。もう一度お試しください。',
  'no-refresh': '再接続のための許可が得られませんでした。もう一度お試しください。',
  failed: '接続できませんでした。',
  unconfigured: 'Google の認証情報（GOOGLE_CLIENT_ID など）が設定されていません。',
};
