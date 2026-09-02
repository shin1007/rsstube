'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * 記事を他のアプリへ渡す。
 *
 * スマホで読んで、誰かに送る・自分のメモへ送る導線がゼロだった（元記事を
 * ブラウザで開き直して、そちらの共有を使うしかない）。`navigator.share` は
 * OS の共有シートをそのまま開くので、こちらは何も持たなくてよい。
 *
 * **使えないときはボタンを出さない。** PC のブラウザには無いことがあり、
 * 押して何も起きないのがいちばん悪い（`docs/traps/ui.md` の「押しても何も
 * 起きない」と同じ）。判定はブラウザに聞くしかないので、サーバー側では
 * 必ず「無い」を返し、載ってから出す（usePasskeySupport と同じ書き方。
 * useEffect + setState にすると描画をもう1回増やすことになる）。
 *
 * 渡すのは**訳した見出しと元記事のURL**。要点まで入れると、受け取った側には
 * こちらのAIの文章が本人の言葉のように見える。中身は元記事に読みに行ってもらう。
 */
const NO_SUBSCRIBE = () => () => {};

export function ShareButton({ title, url }: { title: string; url: string }) {
  const ready = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(timer);
  }, [done]);

  if (!ready) return null;

  return (
    <button
      type="button"
      aria-label="共有する"
      onClick={async () => {
        try {
          await navigator.share({ title, url });
          setDone(true);
        } catch {
          // 共有シートを閉じただけでも reject が来る。失敗として見せない。
        }
      }}
      className="bar-button shrink-0 whitespace-nowrap rounded px-2 text-xs text-zinc-500 hover:text-zinc-100 md:py-1 md:text-sm"
    >
      {done ? '✓' : '↑'}
    </button>
  );
}
