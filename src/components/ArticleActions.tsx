'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { setStarred } from '@/app/actions/articles';

/**
 * 記事のスター。
 *
 * 以前は素の `<form action={サーバー関数}>` だった。動いてはいたが、
 * **押してから色が変わるまでサーバーの往復ぶん待つ**ので、押せたのかどうかが
 * 分からない（スマホの回線だと1秒近く無反応に見える）。
 *
 * ここでは3つのことをする:
 *   1. 押した瞬間に見た目を変える（楽観更新）
 *   2. 反映中は薄くして、まだ確定していないことを示す
 *   3. 何が起きたかを短い帯で出す。取り消しもそこから押せる
 *
 * 失敗したら見た目を元に戻し、帯にその旨を出す。黙って戻すと
 * 「押したのに消えた」という一番分かりにくい壊れ方になる。
 *
 * **置き場所は2つ。** PC は本文の上の帯（`variant="bar"`）、スマホは画面の下の
 * 「前の記事 / 次の記事」の帯の真ん中（`variant="nav"`）。スマホでは以前
 * メニュー（ArticleMobileMenu）の中にあり、**開いてから押すので2回**、しかも
 * 押す行は `text-xs` の文字1行ぶんしかなかった。記事を読みながらいちばん
 * 押すものなので、帯の上に1回で押せる大きさで出す。
 */
export function ArticleActions({
  articleId,
  starred,
  variant = 'bar',
}: {
  articleId: string;
  starred: boolean;
  variant?: 'bar' | 'nav';
}) {
  const [flash, setFlash] = useState<{ text: string; undo?: () => void } | null>(null);

  return (
    <>
      <Toggle
        articleId={articleId}
        active={starred}
        label="★ スター"
        short="★"
        activeClass="text-amber-400"
        onLabel="スターを付けました"
        offLabel="スターを外しました"
        action={setStarred}
        onFlash={setFlash}
        variant={variant}
      />
      {flash && <ActionFlash {...flash} onDismiss={() => setFlash(null)} />}
    </>
  );
}

function Toggle({
  articleId,
  active,
  label,
  short,
  activeClass,
  onLabel,
  offLabel,
  action,
  onFlash,
  variant,
}: {
  articleId: string;
  active: boolean;
  label: string;
  /** 狭い画面で出す短い形。記号だけにして、上の帯を1行に収める。 */
  short: string;
  activeClass: string;
  onLabel: string;
  offLabel: string;
  action: (articleId: string, value: boolean) => Promise<void>;
  onFlash: (f: { text: string; undo?: () => void } | null) => void;
  variant: 'bar' | 'nav';
}) {
  const [shown, setShown] = useState(active);
  const [pending, startTransition] = useTransition();

  // サーバーから新しい値が来たらそちらに合わせる。記事を切り替えたときや、
  // 別の端末で操作したときに、古い楽観値が残らないようにする。
  const serverValue = useRef(active);
  useEffect(() => {
    if (serverValue.current !== active) {
      serverValue.current = active;
      setShown(active);
    }
  }, [active]);

  const run = (next: boolean, announce: boolean) => {
    setShown(next);
    startTransition(async () => {
      try {
        await action(articleId, next);
        if (announce) {
          onFlash({
            text: next ? onLabel : offLabel,
            undo: () => run(!next, false),
          });
        } else {
          onFlash({ text: '取り消しました' });
        }
      } catch {
        setShown(!next);
        onFlash({ text: '保存できませんでした。通信を確かめてもう一度' });
      }
    });
  };

  if (variant === 'nav') {
    return (
      <button
        type="button"
        aria-pressed={shown}
        disabled={pending}
        onClick={() => run(!shown, true)}
        aria-label={label}
        // **枠は帯の高さいっぱい × 56px。** 前後のボタンと同じく、画面の下端を
        // 見ずに押すものなので下限（44px）ぴったりにはしない。
        // 付いていないときは白抜きの ☆ にする——色だけの違いだと、暗い帯の上では
        // 「押せるもの」に見えない（灰色の ★ は飾りに見える）。
        className={`flex w-14 items-center justify-center text-2xl leading-none transition-opacity select-none no-callout touch-manipulation active:bg-zinc-800 ${
          shown ? activeClass : 'text-zinc-400'
        } ${pending ? 'opacity-50' : ''}`}
      >
        <span aria-hidden>{shown ? '★' : '☆'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      // 支援技術にも状態が伝わるようにする。色だけだと読み上げに出ない。
      aria-pressed={shown}
      disabled={pending}
      onClick={() => run(!shown, true)}
      // 読み上げには短い形ではなく、いつも同じ言葉を渡す。
      aria-label={label}
      className={`bar-button shrink-0 whitespace-nowrap rounded px-2 text-xs transition-opacity md:py-1 md:text-sm ${
        shown ? activeClass : 'text-zinc-500 hover:text-zinc-300'
      } ${pending ? 'opacity-50' : ''}`}
    >
      <span className="md:hidden">{short}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/** 一覧側（キーボード・スワイプ）からも同じ帯を使うので外に出す。 */
export function ActionFlash({
  text,
  undo,
  onDismiss,
}: {
  text: string;
  undo?: () => void;
  onDismiss: () => void;
}) {
  // 出しっぱなしにすると本文に被る。取り消しを押す間だけ残す。
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [text, undo, onDismiss]);

  return (
    <div
      // 読み上げにも伝える。押した結果が画面の色でしか分からない状態を残さない。
      role="status"
      aria-live="polite"
      // 下の帯（前後の記事・下部タブ）はどちらもホームバーぶん背が伸びる。
      // 足さないと、ホームバーのある iPhone では帯の上端に被る。
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-sm items-center gap-3 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg md:bottom-4"
    >
      <span className="flex-1">{text}</span>
      {undo && (
        <button
          type="button"
          onClick={() => {
            undo();
            onDismiss();
          }}
          className="font-semibold text-sky-400 hover:text-sky-300"
        >
          取り消す
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="閉じる"
        className="text-zinc-500 hover:text-zinc-300"
      >
        ✕
      </button>
    </div>
  );
}
