'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 「?」を押すと説明が出る小さなヘルプ。
 *
 * title 属性は hover が要るのでスマホでは出ない。かといって説明文を常に画面へ
 * 置くと、毎日読む画面では邪魔になる。押したときだけ出す形にする。
 *
 * 位置は fixed で、開くときにボタンの位置から計算する。
 * 以前は親を基準にした absolute だったが、それだと **スクロール枠に切られた**。
 * 本文側の「?」は「AI要約」バッジのすぐ後ろ＝左寄りにあり、right-0 を基準に
 * 左へ256px伸びると、overflow-y-auto の枠外に出てしまう。
 * fixed なら枠の影響を受けず、画面の端でも自分で収まる位置に寄せられる。
 */

/** 吹き出しの幅。画面が狭いときは画面幅に合わせる。 */
const WIDTH = 256;
/** 画面の端との余白。 */
const MARGIN = 8;

export function HelpTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);

  /** ボタンの位置から、画面に収まる場所を決める。 */
  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);

    // 右端を「?」に合わせるのが基本。はみ出すぶんだけ画面内へ押し戻す。
    const left = Math.min(
      Math.max(rect.right - width, MARGIN),
      window.innerWidth - width - MARGIN,
    );

    // 下に出すと画面から出てしまうときは上に出す。高さは実測できないので
    // 目安（120px）で判断する。少し余っても読めるほうを優先する。
    const below = rect.bottom + 6;
    const top = below + 120 > window.innerHeight ? Math.max(rect.top - 126, MARGIN) : below;

    setPos({ left, top, width });
  }, []);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // 画面が動いたら位置がずれる。追従させるより閉じるほうが素直。
    function onMove() {
      setOpen(false);
    }

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // capture を付けるのは、スクロールする要素が入れ子でも拾うため。
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        // 見た目は16pxの丸のままで、**当たり判定だけ 36px に広げる**（before の
        // 透明な枠）。16×16 は指で狙える大きさではないし、WCAG 2.5.8 の下限
        // （24×24）にも届いていなかった。44 まで広げないのは、隣（重要度バッジ・
        // 並び順の select）に被って、そちらへの指を奪うため。
        className="relative grid size-4 shrink-0 place-items-center rounded-full border border-zinc-700 text-[13px] leading-none text-zinc-500 before:absolute before:-inset-2.5 before:content-[''] hover:border-zinc-500 hover:text-zinc-300"
      >
        ?
      </button>

      {open && pos && (
        <span
          ref={tipRef}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          className="fixed z-50 rounded border border-zinc-700 bg-zinc-900 p-2 text-[14px] leading-relaxed font-normal text-zinc-300 shadow-lg"
        >
          {text}
        </span>
      )}
    </>
  );
}
