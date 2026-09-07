'use client';

import { memo, useCallback, useRef, useState, useTransition } from 'react';
import { markRead, setStarred } from '@/app/actions/articles';
import { formatFetched, type StatePatch } from '@/lib/article-rows';
import { JST } from '@/lib/datetime';
import type { ArticleRow } from '@/lib/types';

/**
 * 一覧の1行。
 *
 * **`memo` してあるのは、一覧が60行あるから。** 親（ArticleList）は指の操作の
 * たびに描き直す——引っぱって更新は `touchmove` ごとに、帯（flash）・ヘルプ・
 * ドロワー・カーソル移動もそれぞれ state を持っている。素直に書くと**そのたびに
 * 60行が丸ごと描き直し**になり、いちばん重い引っぱり中に指が引っかかる。
 * このプロジェクトは React Compiler を入れていないので、自動では畳まれない。
 *
 * **memo を効かせるために、親から渡すものは全部「変わらないもの」にしてある。**
 * 行ごとの `() => ...` を props に置くと毎回別物になって memo が素通りするので、
 * 位置（`index`）と id を**こちらから渡し返す**形にしている。増やすときも
 * 同じ約束を守ること（渡すのは `useCallback` で包んだものだけ）。
 */
export type RowHandlers = {
  /** 行の DOM を親に預ける（j/k のスクロール追従で使う）。 */
  register: (index: number, el: HTMLElement | null) => void;
  onOpen: (index: number, id: string) => void;
  onFocus: (index: number) => void;
  /** スワイプで何をしたかを親に伝え、帯で出してもらう。 */
  onFlash: (text: string) => void;
  /** 継ぎ足したぶんの行は親が state で持っている。押した結果を親へ返す。 */
  onPatch: (id: string, patch: StatePatch) => void;
  /** 開きそうだと分かった時点（上に載せる）で本文を取りに行かせる。 */
  onIntent: (id: string) => void;
  /** 長押し（PCは右クリック）で、ここから下を既読にする。 */
  onMarkBelow: (index: number) => void;
};

/** これ以上滑らせたら実行する。指の迷いで走らないくらいには深く。 */
const THRESHOLD = 80;

export const ArticleListRow = memo(function ArticleListRow({
  index,
  article,
  active,
  selected,
  register,
  onOpen,
  onFocus,
  onFlash,
  onPatch,
  onIntent,
  onMarkBelow,
}: RowHandlers & {
  index: number;
  article: ArticleRow;
  active: boolean;
  selected: boolean;
}) {
  const [, startTransition] = useTransition();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipe, setSwipe] = useState(0);
  const [releasing, setReleasing] = useState(false);

  const read = article.state?.is_read ?? false;
  // 訳した見出し（0023）。無ければ原題のまま。
  const heading = article.summary?.title_ja?.trim() || article.title;

  // 何が起きるかをスワイプ中に見せる。滑るだけだと壊れて見える。
  const willAct = Math.abs(swipe) > THRESHOLD;
  const leftAction = swipe < 0; // 左へ = 既読

  // ref も index に紐づけて作り直さない。ここで包まないと親から渡す時点で
  // 毎回別の関数になり、memo が効かなくなる。
  const setRef = useCallback(
    (el: HTMLElement | null) => register(index, el),
    [register, index],
  );

  return (
    <div className="relative overflow-hidden border-b border-zinc-900">
      {/* 行の背後。スワイプで顔を出す。 */}
      {swipe !== 0 && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center px-4 text-xs font-semibold ${
            leftAction
              ? 'justify-end bg-zinc-700 text-zinc-200'
              : 'justify-start bg-sky-900 text-sky-200'
          } ${willAct ? 'opacity-100' : 'opacity-50'}`}
        >
          {leftAction ? (read ? '未読に戻す' : '既読にする') : article.state?.is_starred ? 'スターを外す' : 'スターを付ける'}
        </div>
      )}

      <article
        ref={setRef}
        tabIndex={0}
        role="button"
        aria-current={selected ? 'true' : undefined}
        onFocus={() => onFocus(index)}
        onClick={() => onOpen(index, article.id)}
        // マウスを載せた時点で先に取りに行く。押してから始めると、その往復
        // （RSC 89KB）を必ず待つことになる。載せただけで離れたぶんは5分間
        // 手元に残るので、あとで開いたときに効く。
        //
        // **押した瞬間（pointerdown）には取りに行かない。** 押してから click
        // までは数十ミリ秒しかなく、取得が終わらないうちに遷移が始まる。
        // 走っている途中の先読みは遷移には使われないので、**同じページを
        // サーバーが2回組み立てるだけ**になる（実測で2本飛んでいた）。
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') onIntent(article.id);
        }}
        /**
         * 長押し（スマホ）と右クリック（PC）で、ここから下を既読にする。
         *
         * `contextmenu` を使うのは、**この2つが同じ1つのイベントで来る**から。
         * 長押しを自前のタイマーで作ると、既にあるスワイプ（左=既読 / 右=スター）と
         * 指の取り合いになる。標準のイベントに乗れば競合しない。
         * 押し間違いは取り消しの帯で戻せる。
         */
        onContextMenu={(e) => {
          e.preventDefault();
          onMarkBelow(index);
        }}
        onKeyDown={(e) => {
          // 行そのものにフォーカスがあるとき用。全体のショートカットとは別。
          if (e.key === ' ') {
            e.preventDefault();
            onOpen(index, article.id);
          }
        }}
        onTouchStart={(e) => {
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          setReleasing(false);
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const dx = e.touches[0].clientX - touchStart.current.x;
          const dy = e.touches[0].clientY - touchStart.current.y;
          // 縦スクロールと取り違えないよう、横移動が明確なときだけ追従させる。
          if (Math.abs(dx) > Math.abs(dy)) setSwipe(dx);
        }}
        onTouchEnd={() => {
          const dx = swipe;
          setReleasing(true);
          setSwipe(0);
          touchStart.current = null;
          if (dx < -THRESHOLD) {
            onFlash(read ? '未読に戻しました' : '既読にしました');
            onPatch(article.id, { is_read: !read });
            startTransition(() => void markRead(article.id, !read));
          } else if (dx > THRESHOLD) {
            const next = !article.state?.is_starred;
            onFlash(next ? 'スターを付けました' : 'スターを外しました');
            onPatch(article.id, { is_starred: next });
            startTransition(() => void setStarred(article.id, next));
          }
        }}
        style={swipe !== 0 ? { transform: `translateX(${swipe}px)` } : undefined}
        className={`relative cursor-pointer px-3 py-2.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] ${
          releasing ? 'transition-transform duration-150' : ''
        } ${
          selected
            ? 'bg-[var(--color-accent-subtle)] border-l-2 border-[var(--color-accent)]'
            : active
              ? 'bg-zinc-900/90 shadow-[inset_2px_0_0_0_var(--color-accent)]'
              : 'bg-zinc-950 hover:bg-zinc-900/60'
        }`}
      >
        <div className="flex items-start gap-2">
          {!read && (
            <span
              aria-label="未読"
              className="mt-1.5 size-2 shrink-0 rounded-full shadow-sm"
              style={{ backgroundColor: 'var(--color-accent)' }}
            />
          )}
          {/*
            訳した見出しがあればそれを主にする。記事の42%（1262件中531件）が
            英語のフィードで、原題のままだと一覧を目で追うのが重い。
            原題は捨てずに下に小さく残す（訳が的外れなときに気づけるように）。
          */}
          <h3 className={`flex-1 text-sm leading-snug ${read ? 'text-zinc-500' : 'font-semibold text-zinc-50'}`}>
            {heading}
            {heading !== article.title && (
              <span className="mt-0.5 block text-[14px] font-normal text-zinc-600">
                {article.title}
              </span>
            )}
          </h3>
        </div>

        {/* AI要点。ここが読めれば記事を開かずに判断できる。 */}
        {article.summary?.bullets?.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {article.summary.bullets.slice(0, 3).map((b, i) => (
              <li key={i} className="text-xs leading-relaxed text-zinc-400">
                ・{b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">
            {/*
              **「要約待ち…」は待てば来るときだけ出す。**
              本文もRSSの抜粋も無い記事には要約を作らない（モデルに渡しても
              「本文は存在しない」という入力の説明が返るだけなので）。
              取りに行った跡（extracted_at）があるのに何も無いなら、
              待っても何も来ない。そう書かないと永久に待たせることになる。
            */}
            {article.excerpt ?? (article.extracted_at ? '本文なし（元記事で読めます）' : '要約待ち…')}
          </p>
        )}

        {/* **1行に収める。** 折り返すと「取得」と時刻が上下に割れて、行の高さが
            記事ごとに変わる（実測。PCの一覧で見出しの左端が揃わなくなる）。
            縮めてよいのは情報源の名前だけで、日付と時刻は縮めない。 */}
        <div className="mt-1.5 flex items-center gap-2 overflow-hidden text-[14px] text-zinc-600">
          <span className="min-w-0 truncate">{article.feed?.title}</span>
          {article.published_at && (
            <time dateTime={article.published_at} className="shrink-0 whitespace-nowrap">
              {new Date(article.published_at).toLocaleDateString('ja-JP', {
                timeZone: JST,
                month: 'numeric',
                day: 'numeric',
              })}
            </time>
          )}
          {/* 記事の日付の隣に、こちらへ入ってきた時刻。**同じ日なら時刻だけ**にする
              ——一覧では日付が2つ並ぶより、違う日のときだけ日付が出るほうが目立つ。 */}
          {article.created_at && (
            <time
              dateTime={article.created_at}
              title={`取得 ${new Date(article.created_at).toLocaleString('ja-JP', { timeZone: JST })}`}
              className="shrink-0 whitespace-nowrap text-zinc-700"
            >
              取得{formatFetched(article.created_at, article.published_at)}
            </time>
          )}
          {article.state?.is_starred && (
            <span title="スター" className="text-amber-400">
              ★
            </span>
          )}
          {article.state?.exported_at && (
            <span title="NotebookLM へ書き出し済み" className="text-emerald-400">
              NLM
            </span>
          )}
        </div>
      </article>
    </div>
  );
});
