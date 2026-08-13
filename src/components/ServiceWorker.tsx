'use client';

import { useEffect } from 'react';

/**
 * サービスワーカーの登録。
 *
 * 何も描かない。ホーム画面に追加できるようにするのと、
 * 圏外での画面遷移に offline.html を出すために要る。
 *
 * 開発中は登録しない。Turbopack の差し替えとキャッシュが噛み合わず、
 * 直したはずのものが出てこない原因になりやすいため。
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // load を待つのは、初回訪問で登録処理が本体の読み込みと帯域を取り合わないように。
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 登録できなくてもアプリは普通に動く（PWAとして使えないだけ）。
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
