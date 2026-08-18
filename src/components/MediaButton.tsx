'use client';

import { requestArticleMedia, requestDigestMedia } from '@/app/actions/media';
import Link from 'next/link';
import { useState, useTransition } from 'react';

/**
 * 「音声にする」ボタン。
 *
 * 押しても即座には何もできない（ワーカーが台本→合成を進める）。
 * 押した手応えが無いと二度三度押されるので、状態と行き先を出す。
 *
 * 失敗の文面は Server Action の**戻り値**から取る。本番では throw された
 * エラーの中身が digest に置き換わり、ここで catch できるのは
 * 「Minified React error #441」だけになるため（actions/media.ts のコメント）。
 */
export function MediaButton({
  articleId,
  digestId,
  label = '音声にする',
}: {
  articleId?: string;
  digestId?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ id: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = articleId
          ? await requestArticleMedia(articleId)
          : digestId
            ? await requestDigestMedia(digestId)
            : null;
        if (!r) return;
        if (r.ok) setResult({ id: r.id, message: r.message });
        else setError(r.message);
      } catch (e) {
        // ここに来るのは通信断か、サーバー側で想定していない落ち方をしたとき。
        // 本番だと中身は伏せられるので、開発時のために console にだけ残す。
        console.error(e);
        setError('音声化を受け付けられませんでした。通信を確かめて、もう一度お試しください。');
      }
    });
  };

  if (result) {
    return (
      <span className="text-xs text-zinc-400">
        {result.message}{' '}
        <Link href={`/watch/${result.id}`} className="text-zinc-200 underline">
          開く
        </Link>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded px-2 py-1 text-sm text-zinc-500 hover:text-zinc-100 disabled:opacity-50"
      >
        {pending ? '受付中…' : label}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}
