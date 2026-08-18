'use client';

import type { PlayableSegment } from '@/lib/media/list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 再生の中身。再生ページ（/watch）と一覧ページの下部プレイヤーで同じものを使う。
 *
 * 音声はセグメント（クリップ）に割ってあるので、ここでの同期は
 * 「今のクリップが終わったら次を鳴らし、そのクリップが指すスライドを出す」だけ。
 * 時刻からスライドを逆算する処理が要らないのは、生成側で切れ目を
 * スライドの切り替わりに合わせてあるため（lib/media/jobs.ts）。
 *
 * ただし**シークだけは全体の時刻で考える**。聴き手にとっては1本の番組なので、
 * 「12分中の7分あたり」で掴めないと戻れない。starts[] にクリップの開始時刻を
 * 積んでおいて、掴んだ秒数から「どのクリップの何秒目か」に直す。
 *
 * 音だけで聴くときのために MediaSession も入れてある。ロック画面や
 * イヤホンのボタンから操作できないと、通勤中に使えない。
 */

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export function usePlayer({
  mediaId,
  title,
  segments,
}: {
  mediaId: string;
  title: string;
  segments: PlayableSegment[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  /** つまみを掴んでいる間の位置。離すまで音は動かさない（クリップを跨ぐたびに読み直すと重い）。 */
  const [scrub, setScrub] = useState<number | null>(null);
  /** src を差し替えた直後に飛びたい秒数。メタデータが来るまで currentTime は効かない。 */
  const pending = useRef<number | null>(null);

  /** 各クリップが全体の何秒目から始まるか。 */
  const starts = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const s of segments) {
      out.push(acc);
      acc += s.durationSec;
    }
    return out;
  }, [segments]);

  const total = useMemo(
    () => segments.reduce((sum, s) => sum + s.durationSec, 0),
    [segments],
  );

  const segment = segments[current];
  const position = scrub ?? (starts[current] ?? 0) + elapsed;

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
      pending.current = null;
      setCurrent(next);
      setElapsed(0);
    },
    [segments.length],
  );

  /** 全体の秒数で飛ぶ。クリップを跨ぐときは src の差し替えを待ってから位置を入れる。 */
  const seek = useCallback(
    (at: number) => {
      const t = Math.max(0, Math.min(at, total));
      let i = starts.length - 1;
      while (i > 0 && starts[i] > t) i -= 1;
      const offset = t - (starts[i] ?? 0);

      if (i === current) {
        const el = audioRef.current;
        // 読み込み前に currentTime を入れても捨てられるので、その場合は預けておく。
        if (el && el.readyState > 0) el.currentTime = offset;
        else pending.current = offset;
      } else {
        pending.current = offset;
        setCurrent(i);
      }
      setElapsed(offset);
    },
    [starts, total, current],
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

  const cycleSpeed = useCallback(() => {
    setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length]);
  }, []);

  // クリップを跨いでも再生し続ける。src が変わったら鳴らし直す必要がある。
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
    if (!playing) return;

    void el.play().catch((err: unknown) => {
      // src を差し替えると、まだ解決していない play() が AbortError で転ぶ
      // （「新しい読み込みで中断された」）。これは次のクリップを読み始めた
      // 合図でしかないので、ここで止めると連続再生が1本ごとに切れる。
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPlaying(false);
    });
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

  /**
   * ロック画面のシークバー。
   *
   * 位置を教えないと、OS は今鳴っているクリップ（数十秒）を番組全体だと思って
   * 描く。全体の長さと今の位置を渡しておけば、ロック画面から掴んで飛べる。
   */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (total <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: total,
        position: Math.max(0, Math.min(position, total)),
        playbackRate: speed,
      });
    } catch {
      // 位置が長さを超えていると弾かれる。表示が古くなるだけなので黙って流す。
    }

    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') seek(d.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (d) => seek(position - (d.seekOffset ?? 10)));
    navigator.mediaSession.setActionHandler('seekforward', (d) => seek(position + (d.seekOffset ?? 10)));
  }, [position, total, speed, seek]);

  /** そのまま <audio> に渡す。要素は使う側が置く（画面ごとに置き場所が違うため）。 */
  const audioProps = {
    src: segment?.url,
    preload: 'auto' as const,
    onPlay: () => setPlaying(true),
    /**
     * **終端でも pause が飛ぶ。**しかも ended より先に来る（仕様の順番が
     * 「paused を立てる → pause → ended」）。素直に受けると、次のクリップへ
     * 進んだ時点で playing が false になっていて、再生の effect が動かない。
     * 1本ぶん鳴らして止まるのはこれ。終端ぶんは無視して、onEnded に任せる。
     */
    onPause: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      if (e.currentTarget.ended) return;
      setPlaying(false);
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      if (pending.current === null) return;
      e.currentTarget.currentTime = pending.current;
      pending.current = null;
    },
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      // つまみを掴んでいる間は表示を動かさない（掴んだ位置が戻されて操作できない）。
      if (scrub === null) setElapsed(e.currentTarget.currentTime);
    },
    onEnded: () => {
      // 最後まで来たら止める。次があるなら続けて鳴らす。
      if (current < segments.length - 1) {
        go(current + 1);
        // 終端の pause を無視しても、他の経路で落ちている場合に備えて立て直す。
        // ここが false のままだと、次のクリップは読み込まれるが鳴らない。
        setPlaying(true);
      } else {
        setPlaying(false);
      }
    },
  };

  return {
    audioRef,
    audioProps,
    segment,
    current,
    playing,
    speed,
    position,
    total,
    starts,
    go,
    seek,
    toggle,
    cycleSpeed,
    setScrub,
  };
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
