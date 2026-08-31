'use client';

import Link from 'next/link';
import { useNeighbours } from '@/lib/trail';

/**
 * 画面の下に据える「前の記事 / 次の記事」。
 *
 * **本文の末尾ではなく、画面の下に据える。**末尾に置いていたときは、長い記事だと
 * そこへ辿り着くのが仕事になっていた（読み終える前に次へ行きたいときには、
 * 無いのと同じだった）。
 *
 * `fixed` にはしない。プレイヤーが出ているときは body の padding が全体を
 * 持ち上げてくれるので（Playback.tsx）、流れの中に置くだけでプレイヤーの上に乗る。
 * fixed にすると自分で避ける必要が出る。
 *
 * 行き先が無い側は押せない見た目にして、場所は空けたままにする。端に来たときに
 * ボタンの位置がずれると、隣を押してしまう。
 *
 * client なのは**来た道を見るため**（lib/trail.ts）。未読ビューでは読んだ記事が
 * 一覧から抜けるので、サーバーが出す「前」は来た道と違う記事になる。
 * ← → キーとスワイプも同じものを見ているので、3つの行き先は必ず一致する。
 */
export function ArticleNav({
  articleId,
  prevHref: serverPrev,
  nextHref: serverNext,
}: {
  articleId: string;
  prevHref?: string;
  nextHref?: string;
}) {
  const { prevHref, nextHref } = useNeighbours(articleId, serverPrev, serverNext);

  if (!prevHref && !nextHref) return null;

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-zinc-800 text-xs"
      // iPhone のホームバーに隠れないように。プレイヤーが出ている間は
      // そちらが先に場所を空けるので、この指定は効かない（0 になる）。
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {prevHref ? (
        <Link
          href={prevHref}
          className="flex-1 py-2 text-center text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          ← 前の記事
        </Link>
      ) : (
        <span className="flex-1 py-2 text-center text-zinc-700">← 前の記事</span>
      )}
      <span aria-hidden className="w-px bg-zinc-800" />
      {nextHref ? (
        <Link
          href={nextHref}
          className="flex-1 py-2 text-center text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          次の記事 →
        </Link>
      ) : (
        <span className="flex-1 py-2 text-center text-zinc-700">次の記事 →</span>
      )}
    </nav>
  );
}
