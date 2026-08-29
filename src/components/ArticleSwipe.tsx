'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * 本文を横に払って、前後の記事へ移る。
 *
 * スマホには「一覧へ戻ってから次を押す」以外の道が無かった（本文の下端まで
 * スクロールすれば導線はあるが、長い記事だとそこまで行くのが仕事になる）。
 *
 * 一覧の行のスワイプ（左=既読 / 右=あとで）とは**別の意味**を持たせている。
 * 同じ指の動きに違う結果を割り当てることになるが、場所が違う（行の上か、
 * 本文の上か）ので取り違えようがない。本文の上で既読を切り替えたい場面も無い。
 *
 * `touchmove` を自分で登録しているのは、`preventDefault()` を効かせるため。
 * React が付ける onTouchMove は passive なので、そこからでは止められず、
 * ブラウザ側の「横に払って戻る」に持っていかれる。
 *
 * **iOS の画面左端からのスワイプは奪えない**（Safari の戻るジェスチャが優先される）。
 * 前の記事へ戻るときは、端ではなく真ん中あたりから払うことになる。
 */

/** これを超えたら移る。指の迷いで飛ばないくらいには深く。 */
const THRESHOLD = 70;

/** 縦スクロールと取り違えないための遊び。ここを過ぎるまで向きを決めない。 */
const LOCK = 12;

export function ArticleSwipe({
  prevHref,
  nextHref,
  children,
}: {
  prevHref?: string;
  nextHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    let start: { x: number; y: number } | null = null;
    let axis: 'none' | 'x' | 'y' = 'none';
    let moved = 0;

    const reset = () => {
      start = null;
      axis = 'none';
      moved = 0;
    };

    const onStart = (e: TouchEvent) => {
      // 2本指はページの拡大。触らない。
      if (e.touches.length !== 1) return reset();

      // 横に流れる要素（コード・表）と入力欄の中から始まった指は、
      // その中の操作のために使う。奪うと表を横に見られなくなる。
      const target = e.target as Element | null;
      if (target?.closest?.('pre, table, input, textarea, select')) return reset();

      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      axis = 'none';
      moved = 0;
      setReleasing(false);
    };

    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;

      const x = e.touches[0].clientX - start.x;
      const y = e.touches[0].clientY - start.y;

      // 向きは一度だけ決めて、途中で乗り換えない。乗り換えると
      // 斜めに動かしたときに本文が上下左右へ揺れる。
      if (axis === 'none') {
        if (Math.abs(x) < LOCK && Math.abs(y) < LOCK) return;
        axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      }
      if (axis !== 'x') return;

      // 行き先が無い向きには動かさない。動いてから「何も起きない」より、
      // はじめから動かないほうが「ここが端だ」と分かる。
      if (!(x < 0 ? nextHref : prevHref)) return;

      // ここまで来たら横のスワイプだと確定。ブラウザの戻る／進むに渡さない。
      e.preventDefault();
      moved = x;
      setDx(x);
    };

    const onEnd = () => {
      const x = moved;
      const href = x < 0 ? nextHref : prevHref;
      reset();
      setReleasing(true);
      setDx(0);
      if (Math.abs(x) > THRESHOLD && href) router.push(href);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    // passive: false でないと preventDefault() が無視される。
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [prevHref, nextHref, router]);

  const willMove = Math.abs(dx) > THRESHOLD;

  return (
    <div ref={box} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 何が起きるかを指の下で見せる。滑るだけだと壊れて見える（一覧と同じ作り）。 */}
      {dx !== 0 && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 z-10 flex items-center px-4 text-xs font-semibold ${
            dx < 0 ? 'right-0' : 'left-0'
          } ${willMove ? 'text-sky-300 opacity-100' : 'text-zinc-500 opacity-60'}`}
        >
          {dx < 0 ? '次の記事 →' : '← 前の記事'}
        </div>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col ${releasing ? 'transition-transform duration-150' : ''}`}
        // 指の動きより控えめに動かす。等倍だと本文が画面から出てしまい、
        // 「移る」のか「消える」のか分からない。
        // **transform を出しっぱなしにしないこと。** 変形している間は
        // 中の position:fixed（HelpTip の吹き出し）がこの枠を基準にしてしまう。
        style={dx !== 0 ? { transform: `translateX(${dx * 0.35}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
