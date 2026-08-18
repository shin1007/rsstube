'use client';

import type { MediaSource } from '@/lib/media/list';
import { useState } from 'react';

/**
 * 元記事へのリンク。
 *
 * 聴いて気になったときに原文へ行けないと、音声が行き止まりになる。
 * 記事1本ぶんならその場でリンク、ダイジェストは束ねた件数ぶんあるので
 * 押したときだけ広げる（8件を常に並べると再生のほうが押しのけられる）。
 *
 * 別タブで開く。同じタブだと再生中の音が止まる。
 */
export function SourceLinks({
  sources,
  dropUp = false,
}: {
  sources: MediaSource[];
  /** 画面下のプレイヤーから使うとき。下に垂らすと画面外に出る。 */
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  if (sources.length === 1) {
    return (
      <a
        href={sources[0].url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      >
        ↗ 元記事
      </a>
    );
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      >
        ↗ 元記事 {sources.length}
      </button>

      {open && (
        // ヘッダーの下に垂らす。スライドの上に重なるが、開いている間だけ。
        <div
          className={`absolute right-0 z-30 max-h-72 w-72 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/98 p-1 shadow-lg sm:w-96 ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <ul>
            {sources.map((s, i) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2 rounded px-2 py-1.5 text-xs leading-relaxed text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <span className="shrink-0 tabular-nums text-zinc-600">{i + 1}</span>
                  <span className="min-w-0">{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
