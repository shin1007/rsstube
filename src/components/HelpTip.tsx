'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 「?」を押すと説明が出る小さなヘルプ。
 *
 * title 属性は hover が要るのでスマホでは出ない。かといって説明文を常に画面へ
 * 置くと、毎日読む画面では邪魔になる。押したときだけ出す形にする。
 */
export function HelpTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-4 place-items-center rounded-full border border-zinc-700 text-[10px] leading-none text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
      >
        ?
      </button>

      {open && (
        // 右端で切れないように、右寄せで出す。幅は本文が2〜3行に収まる程度。
        <span
          role="tooltip"
          className="absolute right-0 top-6 z-30 w-64 rounded border border-zinc-700 bg-zinc-900 p-2 text-[11px] leading-relaxed font-normal text-zinc-300 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
