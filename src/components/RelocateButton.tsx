'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { relocateFeed } from '@/app/actions/feeds';
import { useState, useTransition } from 'react';

/**
 * 「探し直す」ボタン。
 *
 * フィードのURLが変わったとき、古いURLが 301 を返してくれれば巡回が自動で
 * 覚え直す。だが、いきなり 404 になったりドメインごと変わったりすると追えない。
 * そのときは元のサイトから探し直す。
 *
 * 購読をやめて登録し直すのとは違い、フィードの id が変わらないので
 * フォルダも既読もスターもそのまま残る。だから「やめる」より先に試す価値がある。
 */
export function RelocateButton({ feedId }: { feedId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result) return <span className="text-xs text-emerald-400">{result}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const r = await relocateFeed(feedId);
              if (!r.ok) return setError(r.message);
              setResult(`「${r.value.title}」に付け替えました`);
            } catch {
              setError(UNEXPECTED_ERROR);
            }
          });
        }}
        disabled={pending}
        className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-50"
      >
        {pending ? '探しています…' : '探し直す'}
      </button>
      {error && <span className="w-full text-xs text-amber-500">{error}</span>}
    </>
  );
}
