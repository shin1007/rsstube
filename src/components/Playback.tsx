'use client';

import { loadPlayable } from '@/app/actions/media';
import { SeekBar } from '@/components/SeekBar';
import { SourceLinks } from '@/components/SourceLinks';
import type { MediaSource, PlayableSegment } from '@/lib/media/list';
import { fmtTime, usePlayer } from '@/lib/media/usePlayer';
import Link from 'next/link';
import { createContext, useCallback, useContext, useRef, useState, useTransition } from 'react';

/**
 * 一覧ページから直接聴くための下部プレイヤー。
 *
 * 一覧から再生ページへ移ると一覧が消えるので、「次はどれにしよう」と
 * 見比べながら流し聴きができない。画面の下に居座らせて、一覧は一覧のまま
 * 触れるようにする。腰を据えてスライドまで観たいときは「スライド」から
 * /watch へ移る（プレイヤーを2つ作らない、の例外はここだけ）。
 *
 * 音声のURLは押されてから取りに行く。署名付きURLは有効期限つきなので、
 * 一覧の全件ぶんを先に発行しても大半は使われずに切れる。
 */

/**
 * 8ミリ秒の無音（16bit 8kHz の WAV）。
 *
 * ▶ を押した流れの中で、この無音を鳴らして <audio> を起こす。src が空の要素に
 * play() しても起きないので、鳴らせる中身を最初から持たせておく。
 * 素材が届いたら usePlayer が src を差し替える。
 */
const SILENCE = 'data:audio/wav;base64,UklGRqQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

type Target = { id: string; title: string };

const PlaybackContext = createContext<((t: Target) => void) | null>(null);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [segments, setSegments] = useState<PlayableSegment[] | null>(null);
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  /**
   * 鳴らす <audio> はここが持つ。**プレイヤーより上に置くのが肝。**
   *
   * ブラウザは「ユーザー操作で一度鳴らした要素」しか後から鳴らせない。
   * 音声を切り替えるたびに要素ごと作り直すと、そのたび鳴らせなくなる。
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback((t: Target) => {
    // **押した流れの中で**一度鳴らしにいく。素材を取りに行くのを待ってから
    // play() すると、操作から離れた再生とみなされて弾かれることがある
    // （iOS が厳しい）。ここで要素を起こしておけば、あとは差し替えるだけ。
    const el = audioRef.current;
    if (el) {
      // src が空の要素に play() しても起きない。無音を入れてから鳴らす。
      if (!el.getAttribute('src')) el.setAttribute('src', SILENCE);
      void el.play().catch(() => {});
    }

    setTarget(t);
    setSegments(null);
    setSources([]);
    setError(null);
    startLoading(async () => {
      const r = await loadPlayable(t.id);
      if (r.ok) {
        setSegments(r.segments);
        setSources(r.sources);
      }
      else setError(r.message);
    });
  }, []);

  return (
    <PlaybackContext.Provider value={play}>
      {children}

      {target && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:bottom-0"
          style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        >
          {/* 下部タブと重なるぶんだけ、スマホでは持ち上げる。 */}
          <div className="mx-auto max-w-2xl space-y-2 p-3 pb-2 md:pb-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{target.title}</span>
              <SourceLinks sources={sources} dropUp />
              <Link
                href={`/watch/${target.id}`}
                className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-100"
              >
                スライド
              </Link>
              <button
                type="button"
                onClick={() => {
                  // 要素はプレイヤーより上に居るので、閉じただけでは鳴り止まない。
                  audioRef.current?.pause();
                  setTarget(null);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-sm text-zinc-500 hover:text-zinc-200"
                aria-label="プレイヤーを閉じる"
              >
                ✕
              </button>
            </div>

            {loading && <p className="py-3 text-center text-xs text-zinc-500">読み込み中…</p>}
            {error && <p className="py-3 text-center text-xs text-red-400">{error}</p>}
            {segments && (
              // key を付けて、別の音声に切り替えたら状態ごと作り直す。
              <DockPlayer
                key={target.id}
                mediaId={target.id}
                title={target.title}
                segments={segments}
                audioRef={audioRef}
              />
            )}
          </div>
          {/* スマホの下部タブぶんの余白。プレイヤーがタブに隠れないように。 */}
          <div className="h-12 md:hidden" />
        </div>
      )}

      {/*
        音声を切り替えても**この要素は作り直さない**。作り直すと、
        ユーザー操作で起こした状態が失われて鳴らせなくなる。
      */}
      <audio ref={audioRef} preload="auto" />
    </PlaybackContext.Provider>
  );
}

/** 一覧の行に置く再生ボタン。 */
export function PlayButton({ id, title }: { id: string; title: string }) {
  const play = useContext(PlaybackContext);
  if (!play) return null;

  return (
    <button
      type="button"
      onClick={() => play({ id, title })}
      className="mt-0.5 shrink-0 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      aria-label={`${title} を再生`}
    >
      ▶
    </button>
  );
}

function DockPlayer({
  mediaId,
  title,
  segments,
  audioRef,
}: {
  mediaId: string;
  title: string;
  segments: PlayableSegment[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  // 一覧の ▶ は1回で鳴ってほしいので、素材が届いたら勝手に始める。
  const p = usePlayer({
    mediaId,
    title,
    segments,
    audioRef,
    autoPlay: true,
  });

  return (
    <>
      <SeekBar
        segments={segments}
        starts={p.starts}
        position={p.position}
        total={p.total}
        onScrub={p.setScrub}
        onSeek={p.seek}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => p.go(p.current - 1)}
          disabled={p.current === 0}
          className="rounded px-1.5 py-1 text-xs text-zinc-400 disabled:opacity-30"
          aria-label="前へ"
        >
          ◀◀
        </button>

        <button
          type="button"
          onClick={p.toggle}
          className="rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-medium text-zinc-900"
        >
          {p.playing ? '一時停止' : '再生'}
        </button>

        <button
          type="button"
          onClick={() => p.go(p.current + 1)}
          disabled={p.current === segments.length - 1}
          className="rounded px-1.5 py-1 text-xs text-zinc-400 disabled:opacity-30"
          aria-label="次へ"
        >
          ▶▶
        </button>

        <span className="text-[11px] tabular-nums text-zinc-500">
          {fmtTime(p.position)} / {fmtTime(p.total)}
        </span>

        <button
          type="button"
          onClick={p.cycleSpeed}
          className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[11px]"
        >
          {p.speed}×
        </button>
      </div>

    </>
  );
}
