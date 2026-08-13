'use client';

import { deleteFolder } from '@/app/actions/feeds';
import { useState, useTransition } from 'react';

/**
 * フォルダを消すボタン。
 *
 * フィードの購読解除ほど失うものは無い（中のフィードは残って未分類に移るだけ）が、
 * 隣に「購読をやめる」があるので、同じ一押しで消えると押し間違いが起きる。
 * 何が起きるかを一言出して、もう一度押させる。
 */
export function DeleteFolderButton({ id, name, feedCount }: { id: string; name: string; feedCount: number }) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-xs text-zinc-500 hover:text-red-400"
      >
        削除
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="text-zinc-400">
        {feedCount > 0 ? `${feedCount}本は未分類へ。` : ''}削除しますか？
      </span>
      <button
        type="button"
        onClick={() => startTransition(async () => { await deleteFolder(id); })}
        disabled={pending}
        className="rounded bg-red-900/80 px-2 py-0.5 text-zinc-100 disabled:opacity-50"
        aria-label={`${name} を削除`}
      >
        {pending ? '…' : 'はい'}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="px-1 text-zinc-500">
        いいえ
      </button>
    </span>
  );
}
