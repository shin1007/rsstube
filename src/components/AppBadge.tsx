'use client';

import { useEffect } from 'react';

/**
 * ホーム画面のアイコンに未読の数を出す。
 *
 * ホーム画面に置いてあるのに、**開くまで新着があるか分からなかった**。
 * 通知が鳴るのは朝のダイジェストができたときだけで、巡回で記事が入っても
 * 何も起きない。バッジなら、開かずに「読むものがある」が分かる。
 *
 * 通知の許可とは別枠で、インストール済みの PWA ならそのまま出せる。
 * 対応していないブラウザ（デスクトップの一部・iOS の Safari のタブ）では
 * メソッド自体が無いので、何もしない。**try/catch で囲むこと**——
 * 権限まわりで throw する実装があり、ここで落とすと画面全体が落ちる。
 *
 * 何も描かない。数はサイドバーが出しているものと同じ値を受け取る。
 */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;

    try {
      // 0 のときは消す。0 のバッジを出すブラウザがある。
      void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
    } catch {
      // 出せなくてもアプリは普通に動く。
    }
  }, [count]);

  return null;
}
