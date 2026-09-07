'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 記事のどこまで読んだかを覚えて、次に開いたときそこへ戻す。
 *
 * **長い記事は一度で読み切れない。** 実データで最長は 40,000字（審議会の議事録）で、
 * 500字/分なら80分ぶんある。通勤で読むものなので途中で降りるし、圏外に入る。
 * それまでは開き直すたびに先頭からで、**どこまで読んだかを目で探し直す**ことに
 * なっていた。
 *
 * **置き場は localStorage（この端末だけ）。**
 *
 * サーバーに持たせると、スクロールのたびに書き込みが飛ぶ（＝押していないのに
 * 通信が走る）し、端末をまたいで同期する価値はこの使い方には無い——スマホで
 * 読みかけたものをPCで続ける、はまず起きない（PCは補助と決めてある）。
 * `article_states` に列を足すのは、必要になってからでよい。
 *
 * **読み切ったものは覚えない。** 末尾まで行った記事を開き直したときに末尾へ
 * 飛ばされると、「戻れない」ようにしか感じられない。9割まで読んでいたら
 * 「読み終えた」とみなして忘れる。
 */

/** 位置の置き場。形を変えるときは名前ごと変える（古い値を読まないため）。 */
const KEY = 'rsstube:reading-position';

/** 覚えておく件数。開いた順に新しいものだけ残す。 */
const MAX_ENTRIES = 60;

/** これより浅いところは覚えない。数行ぶんの戻しは、かえって迷う。 */
const MIN_OFFSET_PX = 400;

/** ここまで来ていたら「読み終えた」とみなす。 */
const DONE_RATIO = 0.9;

/** 知らせを出しておく長さ。読み切れて、次の操作の邪魔にならない程度。 */
const NOTICE_MS = 5000;

type Store = Record<string, { top: number; at: number }>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    // 壊れていても読書は続けられる。黙って「覚えていない」扱いにする。
    return {};
  }
}

function write(store: Store) {
  try {
    // 溢れる前に、古いものから捨てる。
    const entries = Object.entries(store).sort((a, b) => b[1].at - a[1].at);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))));
  } catch {
    // 容量いっぱい・プライベートモードなど。覚えられないだけで実害は無い。
  }
}

export function ReadingPosition({ articleId }: { articleId: string }) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    /**
     * スクロールしているのは**本文を包んでいる箱**（ArticleView の
     * `data-article-scroll`）。body ではないので、そこを見つけてから繋ぐ。
     * 自分の位置から辿るのは、ページに箱が2つ以上あっても取り違えないため。
     */
    const box = anchor.current?.closest<HTMLElement>('[data-article-scroll]');
    if (!box) return;

    let touched = false;
    const onUserScroll = () => {
      touched = true;
    };
    box.addEventListener('wheel', onUserScroll, { passive: true });
    box.addEventListener('touchstart', onUserScroll, { passive: true });

    // ---- 戻す ----
    const saved = read()[articleId];
    const restore = () => {
      if (touched || !saved) return;
      const max = box.scrollHeight - box.clientHeight;
      // 画像の読み込みで高さが変わるので、収まる位置まで詰めてから使う。
      const top = Math.min(saved.top, max);
      if (max <= 0 || top < MIN_OFFSET_PX) return;
      box.scrollTop = top;
      setResumed(true);
    };
    // 1回目は組み上がった直後、2回目は画像が入って高さが確定したころ。
    const frame = requestAnimationFrame(restore);
    const later = setTimeout(restore, 500);

    // ---- 覚える ----
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      const max = box.scrollHeight - box.clientHeight;
      const top = box.scrollTop;
      const store = read();
      // 末尾まで読んだ／浅すぎるものは覚えない（上の注記）。
      if (max <= 0 || top < MIN_OFFSET_PX || top / max > DONE_RATIO) delete store[articleId];
      else store[articleId] = { top, at: Date.now() };
      write(store);
    };
    const onScroll = () => {
      if (timer) return;
      // 指の下で毎回書かない。止まってから1回だけ書く。
      timer = setTimeout(() => {
        timer = null;
        save();
      }, 400);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    /**
     * **閉じられる瞬間にも書く。** スクロールを止めてすぐ画面を消す／別の記事へ
     * 移ると、上の遅延ぶんが書かれないまま終わる。`pagehide` はスマホの
     * 「アプリを閉じる」でも来る（`beforeunload` は来ない）。
     */
    const onLeave = () => save();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
      if (timer) clearTimeout(timer);
      box.removeEventListener('wheel', onUserScroll);
      box.removeEventListener('touchstart', onUserScroll);
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      // 記事を移るときにも1回書いておく（この effect は記事ごとに作り直される）。
      save();
    };
  }, [articleId]);

  // 知らせは自分で消える。押さないと消えないものを読書の上に置かない。
  useEffect(() => {
    if (!resumed) return;
    const t = setTimeout(() => setResumed(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [resumed]);

  return (
    <>
      {/* 箱を辿るための足場。見えない。 */}
      <span ref={anchor} aria-hidden className="hidden" />

      {/**
       * **黙って途中から出さない。** 先頭にあるはずのものが無いと、読む人は
       * まず「壊れた」と思う。何が起きたかと、先頭へ戻る手を一緒に置く。
       */}
      {resumed && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-800/95 px-4 py-2 text-xs text-zinc-200 shadow-xl backdrop-blur">
            <span>前回の続きから開きました</span>
            <button
              type="button"
              onClick={(e) => {
                // この知らせは箱の中に居るので、そのまま辿れる。
                const box = e.currentTarget.closest<HTMLElement>('[data-article-scroll]');
                box?.scrollTo({ top: 0, behavior: 'smooth' });
                setResumed(false);
              }}
              className="rounded-full border border-zinc-600 px-2.5 py-1 text-zinc-100 hover:bg-zinc-700 active:scale-95 transition cursor-pointer"
            >
              先頭へ
            </button>
          </div>
        </div>
      )}
    </>
  );
}
