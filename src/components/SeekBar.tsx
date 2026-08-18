'use client';

import type { PlayableSegment } from '@/lib/media/list';
import { useRef } from 'react';

/**
 * シークバー。
 *
 * 目盛りはクリップ（＝スライド）の切れ目そのままで、幅はクリップの長さに比例する。
 * ただの1本の帯にしないのは、「次のスライドまであとどれくらいか」が見えると
 * 飛ばす判断ができるため。
 *
 * つまみは `<input type="range">` を透明にして重ねてある。自前で pointer を
 * 拾うより、キーボード操作・タッチのつまみ追従・読み上げが最初から効く。
 *
 * 掴んでいる間は表示だけ動かし、離してから音を飛ばす（onScrub → onSeek）。
 * 動かすたびに飛ばすと、クリップを跨ぐ操作で毎回 mp3 を読み直して固まる。
 */
export function SeekBar({
  segments,
  starts,
  position,
  total,
  onScrub,
  onSeek,
}: {
  segments: PlayableSegment[];
  starts: number[];
  position: number;
  total: number;
  onScrub: (sec: number | null) => void;
  onSeek: (sec: number) => void;
}) {
  const dragged = useRef<number | null>(null);
  const max = Math.max(total, 1);

  const commit = () => {
    if (dragged.current !== null) {
      onSeek(dragged.current);
      dragged.current = null;
    }
    onScrub(null);
  };

  return (
    <div className="relative -my-2 rounded-full py-2 focus-within:ring-1 focus-within:ring-zinc-600">
      <div className="pointer-events-none flex gap-0.5">
        {segments.map((s, i) => {
          const start = starts[i] ?? 0;
          const done =
            s.durationSec > 0
              ? (position - start) / s.durationSec
              : position > start
                ? 1
                : 0;
          return (
            <div
              key={s.idx}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"
              style={{ flexGrow: Math.max(s.durationSec, 1) }}
            >
              <div
                className="h-full bg-zinc-100"
                style={{ width: `${Math.max(0, Math.min(1, done)) * 100}%` }}
              />
            </div>
          );
        })}
      </div>

      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={Math.max(0, Math.min(position, max))}
        onChange={(e) => {
          const v = Number(e.target.value);
          dragged.current = v;
          onScrub(v);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="再生位置"
        aria-valuetext={`${fmt(position)} / ${fmt(total)}`}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
      />
    </div>
  );
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}
