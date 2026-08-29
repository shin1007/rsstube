'use client';

import { deletePasskey } from '@/app/actions/passkeys';
import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { usePasskeySupport } from '@/components/usePasskeySupport';
import { startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export type PasskeyRow = {
  id: string;
  label: string | null;
  device_type: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
};

/**
 * 設定画面のパスキー欄。登録と、要らなくなった鍵の削除。
 *
 * 一覧はサーバー側で読んで渡す（RLS で自分のぶんしか見えない）。ここが持つのは
 * 「ブラウザに鍵を作らせて、その結果をサーバーへ渡す」往復だけ。
 */
export function PasskeyManager({ passkeys }: { passkeys: PasskeyRow[] }) {
  const supported = usePasskeySupport();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const register = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const optionsRes = await fetch('/api/passkeys/register/options', { method: 'POST' });
        if (!optionsRes.ok) throw new Error(await messageOf(optionsRes));
        const optionsJSON = await optionsRes.json();

        const response = await startRegistration({ optionsJSON });

        const verifyRes = await fetch('/api/passkeys/register/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ response, label }),
        });
        if (!verifyRes.ok) throw new Error(await messageOf(verifyRes));
        const result = await verifyRes.json();

        setLabel('');
        setMessage({
          ok: true,
          // 端末に閉じた鍵かどうかで、失くしたときの話が変わる。登録した直後にしか
          // 言う機会が無いので、ここで伝える。
          text: result.backedUp
            ? '登録しました。同じアカウントの他の端末でも使えます。'
            : '登録しました。この端末だけで使えます（端末を失うと、パスワードで入り直すことになります）。',
        });
        router.refresh();
      } catch (e) {
        setMessage({ ok: false, text: readableError(e) });
      }
    });
  };

  const remove = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await deletePasskey(id);
        if (!r.ok) {
          setMessage({ ok: false, text: r.message });
          return;
        }
        setMessage({ ok: true, text: '削除しました。' });
        router.refresh();
      } catch {
        setMessage({ ok: false, text: UNEXPECTED_ERROR });
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        指紋・顔・端末のPINでログインできるようにします。パスワードは残るので、
        別の端末からはこれまでどおり入れます。
      </p>

      {passkeys.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {passkeys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{k.label || '名前なしのパスキー'}</p>
                <p className="text-xs text-zinc-500">
                  {formatDate(k.created_at)}に登録
                  {k.last_used_at ? ` / 最後に使ったのは${formatDate(k.last_used_at)}` : ' / 未使用'}
                  {k.device_type === 'singleDevice' && ' / この端末のみ'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(k.id)}
                disabled={pending}
                className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-red-800 hover:text-red-300 disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported === 'no' ? (
        <p className="text-xs text-amber-400">
          このブラウザはパスキーに対応していません。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="名前（例: iPhone）"
            maxLength={40}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={register}
            disabled={pending || supported === 'unknown'}
            className="shrink-0 rounded border border-zinc-600 px-3 py-2 text-sm hover:border-zinc-400 disabled:opacity-50"
          >
            {pending ? '登録しています…' : 'この端末を登録'}
          </button>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

async function messageOf(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.message === 'string') return body.message;
  } catch {
    // JSON でないときは既定の文面へ。
  }
  return '登録できませんでした';
}

function readableError(e: unknown): string {
  // 同じ端末で二度登録しようとすると InvalidStateError になる。
  // 「失敗」ではなく「もう登録済み」なので、そう言う。
  if (e instanceof WebAuthnError && e.name === 'InvalidStateError') {
    return 'この端末はすでに登録済みです。';
  }
  if (e instanceof WebAuthnError || (e instanceof Error && e.name === 'NotAllowedError')) {
    return '登録を取り消しました。';
  }
  return e instanceof Error ? e.message : UNEXPECTED_ERROR;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}
