'use client';

import { disconnectDrive } from '@/app/actions/drive';
import { useState, useTransition } from 'react';

/**
 * Google Drive の接続。
 *
 * 繋ぐのはリダイレクトが要るので普通のリンク。切るのはサーバーアクションで済む。
 * 何が起きるかは押す前に書いておく（このアプリが作ったファイルしか触らないこと）。
 */
export function DriveConnect({
  connected,
  email,
  notice,
}: {
  connected: boolean;
  email?: string;
  notice?: string;
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
                  await disconnectDrive();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              });
            }}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            {pending ? '切断中…' : '接続を切る'}
          </button>
        </div>
      ) : (
        <a
          href="/api/auth/google/start"
          className="inline-block rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900"
        >
          Google Drive に接続
        </a>
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
