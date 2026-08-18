'use client';

import { SeekBar } from '@/components/SeekBar';
import { SlideView } from '@/components/SlideView';
import type { Slide } from '@/lib/ai/script';
import type { PlayableSegment } from '@/lib/media/list';
import { fmtTime, usePlayer } from '@/lib/media/usePlayer';
import { useState } from 'react';

/**
 * スライド同期の再生。
 *
 * 再生そのものは usePlayer に置いてある（一覧ページの下部プレイヤーと同じ物）。
 * こちらはスライドと字幕を足した、腰を据えて観るほうの画面。
 */
export function Player({
  mediaId,
  title,
  slides,
  segments,
  coverUrl,
}: {
  mediaId: string;
  title: string;
  slides: Slide[];
  segments: PlayableSegment[];
  coverUrl: string | null;
}) {
  const [showText, setShowText] = useState(false);
  const { audioRef, audioProps, ...p } = usePlayer({ mediaId, title, segments });

  if (segments.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-zinc-500">
        まだ再生できる音声がありません。生成が終わるとここに出ます。
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        スライド。16:9 に固定せず、余った縦を使う。
        min-h は入れておく。字幕を開いた狭い画面で、ここだけが潰れて
        「スライドが出ない」ように見えるのを防ぐ。
      */}
      <div className="min-h-32 flex-1 border-b border-zinc-800 bg-zinc-900/40">
        <SlideView
          slide={pickSlide(slides, p.segment?.slideIdx)}
          index={slideIndex(slides, p.segment?.slideIdx)}
          total={slides.length}
          coverUrl={coverUrl}
        />
      </div>

      {/* 字幕。読みながら聴きたいときだけ開く。 */}
      {showText && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-zinc-800 p-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
            {p.segment?.text}
          </p>
        </div>
      )}

      <div
        className="shrink-0 space-y-3 p-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <SeekBar
          segments={segments}
          starts={p.starts}
          position={p.position}
          total={p.total}
          onScrub={p.setScrub}
          onSeek={p.seek}
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => p.go(p.current - 1)}
            disabled={p.current === 0}
            className="rounded px-2 py-1 text-sm text-zinc-400 disabled:opacity-30"
            aria-label="前へ"
          >
            ◀◀
          </button>

          <button
            type="button"
            onClick={p.toggle}
            className="rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900"
          >
            {p.playing ? '一時停止' : '再生'}
          </button>

          <button
            type="button"
            onClick={() => p.go(p.current + 1)}
            disabled={p.current === segments.length - 1}
            className="rounded px-2 py-1 text-sm text-zinc-400 disabled:opacity-30"
            aria-label="次へ"
          >
            ▶▶
          </button>

          <span className="text-xs tabular-nums text-zinc-500">
            {fmtTime(p.position)} / {fmtTime(p.total)}
          </span>

          <button
            type="button"
            onClick={p.cycleSpeed}
            className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs"
          >
            {p.speed}×
          </button>

          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400"
          >
            字幕
          </button>
        </div>
      </div>

      <audio ref={audioRef} {...audioProps} />
    </div>
  );
}

/**
 * そのクリップが指すスライドを選ぶ。
 *
 * 指した先が無いときは手前のスライドまで下がる。モデルがスライドを台本より
 * 少なく返すことがあり（CLAUDE.md）、素直に引くと undefined になって
 * 画面が「…」だけになる。1枚前を出し続けるほうが、何も出ないよりましで、
 * 生成が途中の音声を先に聴くときにも効く。
 */
function pickSlide(slides: Slide[], idx: number | undefined): Slide | undefined {
  if (slides.length === 0) return undefined;
  return slides[slideIndex(slides, idx)];
}

/** 実際に出す1枚の添字。差し色と「何枚目」の表示も同じものを見る。 */
function slideIndex(slides: Slide[], idx: number | undefined): number {
  return Math.max(0, Math.min(idx ?? 0, slides.length - 1));
}
