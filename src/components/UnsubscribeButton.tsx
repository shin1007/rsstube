'use client';

import {
  deleteFeed,
  feedImpact,
  resubscribeFeed,
  type UnsubscribeImpact,
} from '@/app/actions/feeds';
import { useState, useTransition } from 'react';

/**
 * 購読をやめるボタン。
 *
 * 以前は「削除」の一押しで即座に消えていた。実際に消えるのは自分の状態行で、
 * スターや書き出し済みの印も巻き添えになっていた（0012 で印は残るようにした）。
 * それでも未読は消えるし、押し間違いは起きるので、押す前に
 * 「何件が一覧から消えて、何が残るのか」を数えて見せる。
 *
 * やめた直後は元に戻せる。フィードは掃除の対象にならないので購読を作り直せば戻る
 * （印の無かった記事の既読・未読までは戻らない。そのことも書く）。
 */
export function UnsubscribeButton({
  feedId,
  title,
  folderId,
}: {
  feedId: string;
  title: string;
  folderId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [impact, setImpact] = useState<UnsubscribeImpact | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = () => {
    setError(null);
    startTransition(async () => {
      try {
        setImpact(await feedImpact(feedId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const confirm = () => {
    startTransition(async () => {
      try {
        await deleteFeed(feedId);
        setImpact(null);
        setDone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const undo = () => {
    startTransition(async () => {
      try {
        await resubscribeFeed(feedId, folderId);
        setDone(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (done) {
    return (
      <span className="flex items-center gap-2 text-xs text-zinc-500">
        購読をやめました
        <button
          type="button"
          onClick={undo}
          disabled={pending}
          className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 disabled:opacity-50"
        >
          {pending ? '戻しています…' : '元に戻す'}
        </button>
      </span>
    );
  }

  if (impact) {
    const kept = impact.starred + impact.readLater + impact.exported;
    return (
      <div className="w-full rounded border border-amber-900/60 bg-amber-950/20 p-2.5 text-xs">
        <p className="text-zinc-200">「{title}」の購読をやめますか？</p>

        <ul className="mt-1.5 space-y-0.5 text-zinc-400">
          <li>・{impact.dropped}件が一覧から消えます（未読と、読んだだけの記事）</li>
          {kept > 0 ? (
            <li>
              ・
              {[
                impact.starred > 0 ? `スター${impact.starred}件` : null,
                impact.readLater > 0 ? `あとで${impact.readLater}件` : null,
                impact.exported > 0 ? `書き出し済み${impact.exported}件` : null,
              ]
                .filter(Boolean)
                .join('・')}
              は残ります
            </li>
          ) : (
            <li>・印を付けた記事はありません</li>
          )}
          <li className="text-zinc-500">・新しい記事はもう取り込まれなくなります</li>
        </ul>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded bg-red-900/80 px-2.5 py-1 text-zinc-100 disabled:opacity-50"
          >
            {pending ? '解除中…' : '購読をやめる'}
          </button>
          <button
            type="button"
            onClick={() => setImpact(null)}
            disabled={pending}
            className="rounded px-2.5 py-1 text-zinc-400"
          >
            やめる
          </button>
        </div>

        {error && <p className="mt-1.5 text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
      >
        {pending ? '確認中…' : '購読をやめる'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}
