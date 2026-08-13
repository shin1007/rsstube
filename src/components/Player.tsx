'use client';

import { SlideView } from '@/components/SlideView';
import type { Slide } from '@/lib/ai/script';
import type { PlayableSegment } from '@/lib/media/list';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * スライド同期の再生。
 *
 * 音声はセグメント（クリップ）に割ってあるので、ここでの同期は
 * 「今のクリップが終わったら次を鳴らし、そのクリップが指すスライドを出す」だけ。
 * 時刻からスライドを逆算する処理が要らないのは、生成側で切れ目を
 * スライドの切り替わりに合わせてあるため（lib/media/jobs.ts）。
 *
 * 音だけで聴くときのために MediaSession も入れてある。ロック画面や
 * イヤホンのボタンから操作できないと、通勤中に使えない。
 */

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export function Player({
  mediaId,
  title,
  slides,
  segments,
}: {
  mediaId: string;
  title: string;
  slides: Slide[];
  segments: PlayableSegment[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [showText, setShowText] = useState(false);

  const segment = segments[current];
  const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
  // 今のクリップより前の長さを足すと、全体の中の位置になる。
  const before = segments.slice(0, current).reduce((sum, s) => sum + s.durationSec, 0);

  /**
   * 中断したところから再開する。朝の通勤で聴き切れなかったぶんを夜に続けるため。
   *
   * 読み出しは「最初に再生を押したとき」に行う。開いた瞬間に勝手に途中へ飛ぶと、
   * 頭から聴き直したいときに戻す操作が要る。描画中に localStorage を読まないので、
   * サーバー側の描画とも食い違わない。
   */
  const storageKey = `rsstube:pos:${mediaId}`;
  const restored = useRef(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(current));
  }, [storageKey, current]);

  const go = useCallback(
    (idx: number) => {
      const next = Math.max(0, Math.min(idx, segments.length - 1));
      setCurrent(next);
      setElapsed(0);
    },
    [segments.length],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;

    // 初回の再生だけ、前回中断した位置へ移る。
    if (!restored.current) {
      restored.current = true;
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0 && saved < segments.length && current === 0) {
        setCurrent(saved);
        setPlaying(true);
        return;
      }
    }

    if (el.paused) void el.play();
    else el.pause();
  }, [storageKey, segments.length, current]);

  // クリップを跨いでも再生し続ける。src が変わったら鳴らし直す必要がある。
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
    if (playing) void el.play().catch(() => setPlaying(false));
  }, [current, speed, playing]);

  /** ロック画面・イヤホンからの操作。これが無いとポケットに入れたまま使えない。 */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'RSSTube',
      album: `${current + 1} / ${segments.length}`,
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });

    navigator.mediaSession.setActionHandler('play', () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => go(current - 1));
    navigator.mediaSession.setActionHandler('nexttrack', () => go(current + 1));

    return () => {
      for (const a of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) {
        navigator.mediaSession.setActionHandler(a, null);
      }
    };
  }, [title, current, segments.length, go]);

  if (segments.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-zinc-500">
        まだ再生できる音声がありません。生成が終わるとここに出ます。
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* スライド。16:9 に固定せず、余った縦を使う。 */}
      <div className="min-h-0 flex-1 border-b border-zinc-800 bg-zinc-900/40">
        <SlideView slide={slides[segment?.slideIdx ?? 0]} />
      </div>

      {/* 字幕。読みながら聴きたいときだけ開く。 */}
      {showText && (
        <div className="max-h-40 overflow-y-auto border-b border-zinc-800 p-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
            {segment?.text}
          </p>
        </div>
      )}

      <div className="p-3 space-y-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {/* 進み具合。クリップの区切りを目盛りとして出す。 */}
        <div className="flex gap-0.5">
          {segments.map((s, i) => (
            <button
              key={s.idx}
              type="button"
              onClick={() => go(i)}
              title={`${i + 1}/${segments.length}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < current ? 'bg-zinc-500' : i === current ? 'bg-zinc-100' : 'bg-zinc-800'
              }`}
              style={{ flexGrow: Math.max(s.durationSec, 1) }}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={current === 0}
            className="rounded px-2 py-1 text-sm text-zinc-400 disabled:opacity-30"
            aria-label="前へ"
          >
            ◀◀
          </button>

          <button
            type="button"
            onClick={toggle}
            className="rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900"
          >
            {playing ? '一時停止' : '再生'}
          </button>

          <button
            type="button"
            onClick={() => go(current + 1)}
            disabled={current === segments.length - 1}
            className="rounded px-2 py-1 text-sm text-zinc-400 disabled:opacity-30"
            aria-label="次へ"
          >
            ▶▶
          </button>

          <span className="text-xs tabular-nums text-zinc-500">
            {fmt(before + elapsed)} / {fmt(total)}
          </span>

          <button
            type="button"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs"
          >
            {speed}×
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

      <audio
        ref={audioRef}
        src={segment?.url}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onEnded={() => {
          // 最後まで来たら止める。次があるなら続けて鳴らす。
          if (current < segments.length - 1) go(current + 1);
          else setPlaying(false);
        }}
      />
    </div>
  );
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
