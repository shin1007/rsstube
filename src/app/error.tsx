'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * 画面が落ちたときに出す最後の受け皿。
 *
 * これが無いと、サーバー側で1つ例外が出ただけで Next の既定の画面
 * （本番では「Application error: a server-side exception has occurred」だけ）に
 * なる。**戻る導線がどこにも無い**ので、スマホだと閉じるしかない。
 *
 * 実際に落ちる筋はあった——URL に UUID でない `?folder=` が入っていた、
 * 検索語が長すぎて PostgREST に届かなかった、といった**URLを直せば直るもの**が、
 * どれも同じ真っ白な500になっていた。ここで「一覧へ戻る」を出しておけば、
 * 原因が分からなくても自分で抜けられる。
 *
 * `reset()` はそのままもう一度描き直す。一時的な失敗（DBへの往復が転んだ、
 * 無料枠の瞬間的な上限）はこれで戻ることが多い。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番では文面が digest に置き換わるので、コンソールにだけは残す。
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded border border-zinc-800 bg-zinc-900/60 p-4 text-center">
        <p className="text-base font-semibold">画面を出せませんでした</p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          もう一度試すと直ることがあります。直らないときは一覧へ戻ってください
          ——URL の指定（フォルダ・フィード・検索語）が原因のことがあります。
        </p>

        {/* digest は本番で原因を突き合わせる唯一の手掛かり。出しておく。 */}
        {error.digest && (
          <p className="mt-2 font-mono text-[13px] text-zinc-600">{error.digest}</p>
        )}

        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            もう一度
          </button>
          <Link
            href="/"
            className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            一覧へ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
