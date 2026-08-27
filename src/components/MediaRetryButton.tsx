'use client';

import { retryMediaAction } from '@/app/actions/media';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 失敗した音声の「作り直す」ボタン。
 *
 * これが無かったせいで、諦めた音声は画面から手の出しようが無かった。
 * 一覧には赤い理由が出るだけで、押し直そうにも「音声にする」は
 * 一意索引に当たって「既に作ってあります」しか返さない。
 *
 * **できているところは作り直さない**（`0027` の retry_media）ので、
 * 8/10 まで合成できていたなら残り2つだけをやり直す。押した人にどこから
 * 再開したかを見せるのは、無料枠を食う操作だと分かるようにするため。
 *
 * 失敗の文面は Server Action の**戻り値**から取る。本番では throw された
 * エラーの中身が digest に置き換わり、ここで catch できるのは
 * 「Minified React error #441」だけになるため（actions/media.ts のコメント）。
 */
export function MediaRetryButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await retryMediaAction(id);
        if (r.ok) {
          setMessage(r.message);
          // 状態（失敗 → 順番待ち）を出し直す。押したのに赤いままだと、
          // 受け付けられたのかどうかが分からない。
          router.refresh();
        } else {
          setError(r.message);
        }
      } catch (e) {
        console.error(e);
        setError('作り直しを受け付けられませんでした。通信を確かめて、もう一度お試しください。');
      }
    });
  };

  if (message) return <span className="text-xs text-zinc-400">{message}</span>;

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="shrink-0 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
        title="できているところは残したまま、失敗したところだけ作り直します"
      >
        {pending ? '受付中…' : '↻ 作り直す'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}
