'use client';

import { usePasskeySupport } from '@/components/usePasskeySupport';
import { startAuthentication, WebAuthnError } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * ログイン画面の「パスキーでログイン」。
 *
 * メールアドレスは打たせない。登録時に residentKey を required にしてあるので、
 * 端末が「このサイトの鍵」を覚えていて、指紋か顔かPINだけで選べる
 * （api/passkeys/login/options のコメント）。
 *
 * **パスワードのフォームの中に置かないこと。** ボタンは type="button" でも、
 * 同じフォームの中にあると Enter キーの既定の送信先が紛らわしくなる。
 * 経路そのものが別（Route Handler と Server Action）なので、見た目でも分けておく。
 */
export function PasskeySignIn() {
  const supported = usePasskeySupport();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // 扱えない環境では何も出さない。押せないボタンを置くと「押しても何も起きない」と
  // 読まれる。判定が付くまで（'unknown'）も出さないので、ちらつきはしない。
  if (supported !== 'yes') return null;

  const signIn = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const optionsRes = await fetch('/api/passkeys/login/options', { method: 'POST' });
        if (!optionsRes.ok) throw new Error(await messageOf(optionsRes));
        const optionsJSON = await optionsRes.json();

        const response = await startAuthentication({ optionsJSON });

        const verifyRes = await fetch('/api/passkeys/login/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ response }),
        });
        if (!verifyRes.ok) throw new Error(await messageOf(verifyRes));

        // **refresh を先に呼ぶこと。** セッションの Cookie はいま返ってきた
        // 応答で初めて付いたので、手元に残っている「未ログインの /login」を
        // 捨ててからでないと、遷移した先でまた /login へ返される。
        // replace なのは、戻るボタンでログイン画面に戻らせないため。
        router.refresh();
        router.replace('/');
      } catch (e) {
        setMessage(readableError(e));
      }
    });
  };

  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="w-full rounded border border-zinc-600 px-3 py-2 font-medium text-zinc-100 hover:border-zinc-400 disabled:opacity-50"
      >
        {pending ? '確認しています…' : 'パスキーでログイン'}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        この端末に登録したパスキーで入ります。登録は、一度ログインしてから
        設定画面で行います。
      </p>
      {message && <p className="mt-2 text-xs text-red-400">{message}</p>}
    </div>
  );
}

async function messageOf(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.message === 'string') return body.message;
  } catch {
    // JSON でないときは黙って既定の文面へ。
  }
  return 'パスキーで確認できませんでした';
}

/**
 * WebAuthn の失敗をそのまま出さない。
 *
 * ブラウザは中断も未登録も対応外も、まとめて `NotAllowedError` で返してくる。
 * 生の文面（"The operation either timed out or was not allowed"）を出しても
 * 次に何をすればいいか分からないので、こちらで言い直す。
 */
function readableError(e: unknown): string {
  if (e instanceof WebAuthnError || (e instanceof Error && e.name === 'NotAllowedError')) {
    return 'パスキーを確認できませんでした。取り消したか、この端末に登録がありません。';
  }
  return e instanceof Error ? e.message : '通信できませんでした';
}
