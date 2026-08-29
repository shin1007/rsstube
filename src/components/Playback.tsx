'use client';

import { loadPlayable } from '@/app/actions/media';
import { SeekBar } from '@/components/SeekBar';
import { SourceLinks } from '@/components/SourceLinks';
import type { MediaSource, PlayableSegment } from '@/lib/media/list';
import { fmtTime, usePlayer } from '@/lib/media/usePlayer';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react';

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
  const dockRef = useRef<HTMLDivElement | null>(null);

  /**
   * 再生ページには自前のプレイヤーがある。そこでは出さない。
   *
   * 出したままだと**同じ音が2つ鳴る**（要素が別なので、両方が勝手に進む）。
   * 消すだけでなく止めるのは、隠れたまま鳴り続けるのが一番たちが悪いため。
   */
  const pathname = usePathname();
  const onWatchPage = pathname?.startsWith('/watch/') ?? false;

  useEffect(() => {
    if (onWatchPage) audioRef.current?.pause();
  }, [onWatchPage]);

  /**
   * プレイヤーのぶんだけ画面を詰める。
   *
   * プレイヤーは fixed なので、そのままだと各ページの一番下に被る
   * （一覧の最後の記事が読めない）。body に padding を入れると、
   * 中の `flex-1 overflow-y-auto` が自分から縮んでくれるので、
   * ページ側に手を入れずに済む。
   *
   * 高さは測る。決め打ちにすると、タイトルが折り返した時や
   * 読み込み中の表示との差でズレる。
   */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) {
      document.body.style.paddingBottom = '';
      return;
    }

    const apply = () => {
      // プレイヤーはタブの上に浮いているので、下端までの高さで譲る。
      const bottom = window.innerHeight - dock.getBoundingClientRect().top;
      document.body.style.paddingBottom = `${Math.ceil(bottom)}px`;
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    // 画面が回ったり、スマホのアドレスバーが伸縮したときにも 測り直す。
    window.addEventListener('resize', apply);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      document.body.style.paddingBottom = '';
    };
  }, [target, onWatchPage]);

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

      {target && !onWatchPage && (
        <div
          ref={dockRef}
          /*
            スマホでは下部タブの**上**に置く。以前はタブと同じ bottom-0 に置いて、
            中に高さ12の余白を持たせていたが、その余白ごと自分の背景で塗るので
            タブが隠れて他の画面へ移れなくなっていた。
            タブの高さは py-3 + text-xs ＝ 40px と枠線、それに安全領域。
          */
          className="fixed inset-x-0 bottom-[calc(2.6rem+env(safe-area-inset-bottom))] z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:bottom-0"
          style={{ paddingBottom: '0.25rem' }}
        >
          {/* 下部タブと重なるぶんだけ、スマホでは持ち上げる。 */}
          <div className="mx-auto max-w-2xl space-y-2 p-3 pb-2 md:pb-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{target.title}</span>
              <SourceLinks sources={sources} dropUp />
              <Link
                href={`/watch/${target.id}`}
                className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[14px] text-zinc-400 hover:text-zinc-100"
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

        <span className="text-[14px] tabular-nums text-zinc-500">
          {fmtTime(p.position)} / {fmtTime(p.total)}
        </span>

        <button
          type="button"
          onClick={p.cycleSpeed}
          className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[14px]"
        >
          {p.speed}×
        </button>
      </div>

    </>
  );
}
