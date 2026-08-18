'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { removePushSubscription, savePushSubscription, sendTestPush } from '@/app/actions/push';
import { useEffect, useState, useTransition } from 'react';

/**
 * 通知のオン・オフ。
 *
 * 噛み合う相手が多い（ブラウザの許可 / サービスワーカー / VAPID の鍵 / DB の登録）。
 * どこで止まっているのかが分からないと直しようがないので、状態を文章で出す。
 *
 * iOS は特殊で、Safari のタブで開いている間は通知を出せない。ホーム画面に
 * 追加したものから開いたときだけ購読できる（16.4 以降）。そのことも書いておく。
 */

type State =
  | 'loading'
  | 'unsupported'
  | 'needs-install'
  | 'denied'
  | 'off'
  | 'on';

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void (async () => {
      if (typeof window === 'undefined') return;

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        // iOS はホーム画面から開いたときだけ PushManager が生える。
        setState(isIosSafari() && !isStandalone() ? 'needs-install' : 'unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }

      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })();
  }, []);

  const enable = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'denied' : 'off');
          return;
        }

        // 開発中はサービスワーカーを登録していないので、ここで用意する。
        const reg =
          (await navigator.serviceWorker.getRegistration()) ??
          (await navigator.serviceWorker.register('/sw.js'));
        await navigator.serviceWorker.ready;

        const sub = await reg.pushManager.subscribe({
          // 送信元を限定しない購読は今のブラウザでは作れない。
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

        const json = sub.toJSON();
        const saved = await savePushSubscription({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        });
        if (!saved.ok) return setMessage(saved.message);

        setState('on');
        setMessage('オンにしました。テスト送信で確かめられます。');
      } catch {
        setMessage(UNEXPECTED_ERROR);
      }
    });
  };

  const disable = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          const removed = await removePushSubscription(sub.endpoint);
          if (!removed.ok) return setMessage(removed.message);
          await sub.unsubscribe();
        }
        setState('off');
        setMessage('オフにしました。');
      } catch {
        setMessage(UNEXPECTED_ERROR);
      }
    });
  };

  const test = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await sendTestPush();
        setMessage(r.ok ? r.value : r.message);
      } catch {
        setMessage(UNEXPECTED_ERROR);
      }
    });
  };

  if (state === 'loading') return <p className="text-xs text-zinc-600">確認中…</p>;

  if (state === 'unsupported') {
    return <p className="text-xs text-zinc-500">このブラウザは Web Push に対応していません。</p>;
  }

  if (state === 'needs-install') {
    return (
      <p className="text-xs text-zinc-500">
        iPhone / iPad では、共有メニューから「ホーム画面に追加」して、
        そこから開いたときだけ通知を登録できます。
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="text-xs text-amber-500">
        通知がブロックされています。ブラウザのサイト設定から許可し直してください。
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === 'on' ? (
        <>
          <span className="text-xs text-emerald-400">オン</span>
          <button
            type="button"
            onClick={test}
            disabled={pending}
            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-50"
          >
            テスト送信
          </button>
          <button
            type="button"
            onClick={disable}
            disabled={pending}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            オフにする
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={pending}
          className="rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50"
        >
          通知をオンにする
        </button>
      )}

      {message && <span className="w-full text-xs text-zinc-400">{message}</span>}
    </div>
  );
}

/** ホーム画面から起動しているか。 */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS だけ独自プロパティで返す。
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * VAPID の公開鍵は base64url の文字列で来るが、購読 API はバイト列を要求する。
 * atob は標準の base64 しか受けないので、記号を戻してから詰め替える。
 *
 * ArrayBuffer から作るのは型のため。素の `new Uint8Array(n)` は
 * SharedArrayBuffer も取り得る型になり、BufferSource として渡せない。
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  );
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
