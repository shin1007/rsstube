'use client';

import { useEffect } from 'react';
import { BOOT_KEEP, BOOT_KEY, readBootSamples, type BootSample } from '@/lib/boot';

/**
 * **ホーム画面から開いた1回を、その端末に測らせる。** 何も描かない。
 *
 * サーバー側の待ち時間は 3029ms → 246ms まで落ちたのに、iPhone SE では
 * まだ3秒かかっている。ここから先は**サーバーからは見えない**:
 * サービスワーカーの起動（`workerStart` は WebKit が埋めてくれない）、
 * PWA そのものの起動、ハイドレーション。手元の Chromium でも出ない
 * （docs/traps/perf.md の「手元の WebKit は Windows では起動しない」）。
 *
 * なので端末に測らせて localStorage に置き、設定画面で読む
 * （`components/BootTimings.tsx`）。**サーバーへは送らない**——1人しか
 * 使っていないアプリで、そのために口を1つ増やす必要が無い。
 *
 * **測ることで遅くしないこと。** `load` の後、さらに間を置いてから動く。
 * ここで先読みをやらかした前科がある（docs/traps/perf.md の
 * 「走っている途中の先読みは、遷移には使われない」）。
 */

/**
 * `load` から測るまでの間。描画とハイドレーションを邪魔しない。
 *
 * **長くしすぎないこと。** 最初 2.5秒にしたら、一覧が出てすぐ設定を開いた1回で
 * **1件も残らなかった**。ここでやるのは `performance` を読んで文字にするだけで
 * 数msしかかからないので、`load` の後にひと呼吸あれば足りる。
 */
const DELAY_MS = 400;

/** サービスワーカーの返事を待つ上限。返らなくても残りは記録する。 */
const SW_TIMEOUT_MS = 1000;

/** サービスワーカーに「いつ起きた？」と聞く。返らなければ null。 */
function askWorker(): Promise<{ swBootAt: number; navAt: number | null; preload: boolean } | null> {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw?.controller) {
      resolve(null);
      return;
    }
    // MessageChannel を使うのは、**返事の宛先を1本に限る**ため。
    // クライアント全体への postMessage だと、別タブの返事と混ざる。
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), SW_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data ?? null);
    };
    try {
      sw.controller.postMessage({ type: 'rsstube-boot' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export function BootTiming() {
  useEffect(() => {
    /**
     * **1回の読み込みにつき1件。** `load` で測るぶんと、画面を閉じられたときに
     * 慌てて測るぶんが二重に走らないようにする。
     */
    let done = false;

    const run = async () => {
      if (done) return;
      done = true;
      try {
        const nav = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined;
        if (!nav) return;

        const worker = await askWorker();

        /**
         * ワーカーの時刻は素の `Date.now()`。ページの原点（`timeOrigin`）を
         * 引いて、ページの `performance` と同じものさしに揃える。
         * **ワーカー側で引き算させないこと**——あちらの `performance.now()` は
         * 原点が違う（`public/sw.js` の注記）。
         */
        const origin = performance.timeOrigin;
        const rel = (abs: number | null | undefined) =>
          typeof abs === 'number' ? abs - origin : null;

        const paint = performance
          .getEntriesByType('paint')
          .map((p) => p.startTime)
          .sort((a, b) => a - b)[0];

        const conn = (
          navigator as Navigator & {
            connection?: { effectiveType?: string; rtt?: number; downlink?: number };
          }
        ).connection;

        const sample: BootSample = {
          at: Date.now(),
          path: location.pathname,
          standalone: matchMedia('(display-mode: standalone)').matches,
          type: nav.type,
          swStart: rel(worker?.navAt),
          swBoot: rel(worker?.swBootAt),
          preload: Boolean(worker?.preload),
          redirects: nav.redirectCount,
          redirectEnd: nav.redirectEnd,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          transfer: nav.transferSize,
          decoded: nav.decodedBodySize,
          listAt:
            typeof (window as { __rsstubeListAt?: number }).__rsstubeListAt === 'number'
              ? (window as { __rsstubeListAt?: number }).__rsstubeListAt!
              : null,
          dataMs:
            typeof (window as { __rsstubeDataMs?: number }).__rsstubeDataMs === 'number'
              ? (window as { __rsstubeDataMs?: number }).__rsstubeDataMs!
              : null,
          connect: nav.connectEnd,
          paint: paint ?? null,
          interactive: nav.domInteractive,
          load: nav.loadEventEnd,
          screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
          cores: navigator.hardwareConcurrency ?? null,
          net: conn?.effectiveType
            ? `${conn.effectiveType}${conn.rtt ? ` rtt${conn.rtt}` : ''}`
            : null,
        };

        const kept = [sample, ...readBootSamples()].slice(0, BOOT_KEEP);
        localStorage.setItem(BOOT_KEY, JSON.stringify(kept));
      } catch {
        // 測るためのものが画面を壊さないこと。localStorage は
        // プライベートブラウズや容量切れで普通に落ちる。
      }
    };

    // `load` が済んでいなければ待つ。`loadEventEnd` が 0 のまま記録されると、
    // いちばん見たい「完了まで」が欠ける。
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      timer = setTimeout(run, DELAY_MS);
    };

    if (document.readyState === 'complete') start();
    else addEventListener('load', start, { once: true });

    /**
     * **画面を離れられたら、その場で測る。**
     *
     * iOS はホームに戻した時点でページを凍らせる（そのまま捨てることもある）ので、
     * 待っている途中の `setTimeout` は二度と起きない。`load` が済んでいれば
     * 数字は出揃っているので、ここで慌てて残す。
     */
    const flush = () => {
      if (document.readyState === 'complete') run();
    };
    addEventListener('pagehide', flush);
    addEventListener('visibilitychange', flush);

    return () => {
      if (timer) clearTimeout(timer);
      removeEventListener('load', start);
      removeEventListener('pagehide', flush);
      removeEventListener('visibilitychange', flush);
    };
  }, []);

  return null;
}
