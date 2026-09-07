'use client';

import { useEffect } from 'react';

/**
 * 圏外で読むぶんを、静かに手元へ落としておく。
 *
 * 何も描かない。**通勤前に開いたときに、地下鉄で読むぶんを持たせる**のが目的。
 * 取ってくるのは `/api/offline/bundle`（未読20件の本文。画像は落としてある）で、
 * 置き場は Cache Storage。圏外で画面遷移が失敗したときに、サービスワーカーが
 * 出す `public/offline.html` がここから読んで描く。
 *
 * **本体の描画と取り合わせないこと。** 先読みで一度やらかしている
 * （一覧を開いただけで記事2本を丸ごと落としていた。docs/traps/perf.md）。
 * ここは画面が出て落ち着いてから、しかも**1時間に1回まで**にしてある
 * ——巡回が1時間毎なので、それより短くしても新しいものは増えない。
 */

/** 置き場。中身の形を変えたら版を上げる（古いものは activate で消える）。 */
const CACHE = 'rsstube-offline-v1';
const KEY = '/offline-bundle.json';

/** 取り直す間隔。巡回（pg_cron）と同じ1時間。 */
const MAX_AGE_MS = 60 * 60 * 1000;

/** 画面が出てから取りに行くまでの間。描画とハイドレーションを邪魔しない。 */
const DELAY_MS = 4000;

export function OfflineCache() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof caches === 'undefined') return;
    // 圏外で取りに行っても仕方がない。オンラインに戻ったときに下の listener が拾う。
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        if (!navigator.onLine) return;
        // 「データ通信の節約」を出している人からは、勝手に落とさない。
        const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
        if (conn?.saveData) return;

        const cache = await caches.open(CACHE);
        const hit = await cache.match(KEY);
        if (hit) {
          const at = hit.headers.get('date');
          const age = at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
          if (age < MAX_AGE_MS) return;
        }

        const res = await fetch('/api/offline/bundle', { cache: 'no-store' });
        if (!res.ok) return; // 未ログインや一時的な失敗。次の機会に取り直す。

        /**
         * **`date` を自分で付ける。** いつのぶんかは offline.html でも出すし、
         * 取り直しの判断にも使う。サーバーの応答にも date は付くが、
         * ここで付け直しておけば「手元に置いた時刻」で揃う。
         */
        const body = await res.blob();
        await cache.put(
          KEY,
          new Response(body, {
            headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
          }),
        );
      } catch {
        // 保存できなくてもアプリは普通に動く（圏外で読めないだけ）。
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), DELAY_MS);
    };

    schedule();
    // 圏外から戻ったとき・別のタブから戻ったときにも、古ければ取り直す。
    window.addEventListener('online', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', schedule);
    };
  }, []);

  return null;
}
