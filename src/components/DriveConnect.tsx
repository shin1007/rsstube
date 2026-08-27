'use client';

import { ActionForm } from '@/components/ActionForm';
import { UNEXPECTED_ERROR, type ActionResult } from '@/lib/actions/result';
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
  clientId,
  fromEnv = false,
  callbackUrl,
  saveCredentials,
}: {
  connected: boolean;
  email?: string;
  notice?: string;
  /** OAuth クライアントが（設定か環境変数に）入っているか。 */
  configured?: boolean;
  /** クライアントID。秘密ではない（同意画面のURLに載る）ので出してよい。 */
  clientId?: string;
  /** いまの値が環境変数から来ているか。 */
  fromEnv?: boolean;
  /** Google Cloud Console に登録してもらう戻り先。 */
  callbackUrl?: string;
  saveCredentials: (formData: FormData) => Promise<ActionResult<unknown>>;
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

      {/* 未設定のまま押すと、同意画面にも行かずにここへ戻ってくる。 */}
      {!configured && (
        <p className="text-xs text-amber-500">
          まだ Google の認証情報が入っていません。下の欄に入れると接続できるようになります。
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

      {/*
        認証情報。**環境変数から画面へ移した**（0033）。環境変数はデプロイし直さないと
        変えられず、Vercel の画面を触れる人しか設定できなかった。接続そのものは
        各ユーザーが押すだけの操作なのに、その手前が運用作業になっていた。

        **OAuth クライアントはアプリに1つ。**ユーザーごとに作るものではないので、
        ここを1回入れれば、他の人は上の「接続」を押すだけで済む。
      */}
      <details className="rounded border border-zinc-800 p-2" open={!configured}>
        <summary className="cursor-pointer text-xs text-zinc-400">
          Google の認証情報{configured ? '（設定済み）' : '（未設定）'}
        </summary>

        <p className="mt-2 text-xs text-zinc-500">
          {/* 値を取りに行く先を、欄のすぐ上に置く。「Console で作ってください」とだけ
              書いてあっても、そこへ行く手段が無ければ探すところから始まる。 */}
          <a
            href={CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-300"
          >
            Google Cloud Console
          </a>
          {' '}で「OAuth クライアント（ウェブアプリケーション）」を作り、
          その ID とシークレットを入れてください。アプリ全体で1つあれば足ります
          （使う人ごとに作る必要はありません。各ユーザーは上のボタンを押すだけです）。
        </p>

        {callbackUrl && (
          <p className="mt-2 text-xs text-zinc-500">
            「承認済みのリダイレクト URI」には
            <code className="mx-1 rounded bg-zinc-800 px-1 break-all">{callbackUrl}</code>
            を登録してください。ここが1文字でも違うと、同意画面まで進んでから
            Google 側で弾かれます（こちらには何も戻ってこないので、原因が見えません）。
            手元と本番のように URL が複数あるなら、両方登録してかまいません。
          </p>
        )}

        {fromEnv && (
          <p className="mt-2 text-xs text-zinc-500">
            いまは環境変数（<code className="rounded bg-zinc-800 px-1">GOOGLE_CLIENT_ID</code>）の
            値を使っています。ここに入れると、そちらが優先されます。
          </p>
        )}

        <ActionForm action={saveCredentials} className="mt-2 space-y-2" success="保存しました">
          <div>
            <label className="block text-xs text-zinc-400" htmlFor="google_client_id">
              クライアント ID
            </label>
            <input
              id="google_client_id"
              name="google_client_id"
              type="text"
              defaultValue={clientId ?? ''}
              autoComplete="off"
              placeholder="0000000000-xxxxxxxx.apps.googleusercontent.com"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400" htmlFor="google_client_secret">
              クライアントシークレット
            </label>
            <input
              id="google_client_secret"
              name="google_client_secret"
              type="password"
              autoComplete="off"
              placeholder={configured ? '設定済み（変えるときだけ入力）' : ''}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
            />
            {/* 画面へ返していない値なので、空欄は「変えない」の意味にしかならない。
                ここで空文字を保存すると、押しただけで接続が壊れる。 */}
            <p className="mt-1 text-xs text-zinc-600">
              シークレットは画面には出しません。空のまま保存すると、いまの値のままです。
            </p>
          </div>

          <button
            type="submit"
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100"
          >
            認証情報を保存
          </button>
        </ActionForm>
      </details>
    </div>
  );
}

/** 認証情報を作る・直す場所。欄のすぐ上から飛べるようにしてある。 */
const CONSOLE_URL = 'https://console.cloud.google.com/apis/credentials';

const NOTICES: Record<string, string> = {
  connected: '接続しました。書き出しから Drive に置けます。',
  denied: '許可されなかったので接続できていません。',
  state: '接続の途中で情報が食い違いました。もう一度お試しください。',
  'no-refresh': '再接続のための許可が得られませんでした。もう一度お試しください。',
  failed: '接続できませんでした。',
  unconfigured: 'Google の認証情報が入っていません。下の欄から入れてください。',
};
