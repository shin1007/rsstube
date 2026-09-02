'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
 * 行き先が無い側も**押せる**ままにして、押したら「もうありません」と出す。
 * 以前は押せない見た目の span を置いていたが、スマホでは hover が無いので
 * 「淡い文字」と「押せない」が結び付かず、**押しても何も起きない**にしか
 * 見えなかった（そして端まで来たことも分からない）。場所は空けたままにする
 * ——端に来たときにボタンの位置がずれると、隣を押してしまう。
 *
 * client なのは**来た道を見るため**（lib/trail.ts）。未読ビューでは読んだ記事が
 * 一覧から抜けるので、サーバーが出す「前」は来た道と違う記事になる。
 * ← → キーとスワイプも同じものを見ているので、3つの行き先は必ず一致する。
 */

/** 「もうありません」を出しておく長さ。読み切れて、次の操作の邪魔にならない程度。 */
const NOTICE_MS = 2500;

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
  /**
   * どの記事で出した知らせなのかも一緒に持つ。
   *
   * 記事が変われば端かどうかも変わるので、持ち越さずに消す必要がある。
   * ただし effect で消しにいくと描画がもう1回増えるので、**表示のときに
   * 突き合わせて捨てる**（記事が変わった時点で下の text は null になる）。
   */
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const text = notice && notice.id === articleId ? notice.text : null;

  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const cell = 'flex-1 py-2 text-center';
  // iPhone のホームバーぶんは**中のボタン**が持つこと。nav 側の padding にすると、
  // その帯は nav の地色で埋まっているのに、どのリンクにも当たらない
  // ——画面のいちばん下に「押せるように見えて押せない」場所ができる。
  const pad = { paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' };

  return (
    <nav className="relative flex shrink-0 items-stretch border-t border-zinc-800 text-xs">
      {/* 端に来たことを伝える。押しても何も起きないのと、端であることは別物。 */}
      {text && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-x-3 bottom-full z-30 mx-auto mb-2 max-w-sm rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-xs shadow-lg"
        >
          {text}
        </div>
      )}

      {prevHref ? (
        <Link
          href={prevHref}
          style={pad}
          className={`${cell} text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100`}
        >
          ← 前の記事
        </Link>
      ) : (
        <button
          type="button"
          style={pad}
          onClick={() => setNotice({ id: articleId, text: 'これが最初の記事です' })}
          className={`${cell} text-zinc-700`}
        >
          ← 前の記事
        </button>
      )}

      <span aria-hidden className="w-px bg-zinc-800" />

      {nextHref ? (
        <Link
          href={nextHref}
          style={pad}
          className={`${cell} text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100`}
        >
          次の記事 →
        </Link>
      ) : (
        <button
          type="button"
          style={pad}
          onClick={() => setNotice({ id: articleId, text: '次の記事はありません（これが最後です）' })}
          className={`${cell} text-zinc-700`}
        >
          次の記事 →
        </button>
      )}
    </nav>
  );
}
