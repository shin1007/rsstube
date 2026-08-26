'use client';

import { ActionFlash } from '@/components/ArticleActions';
import { HelpTip } from '@/components/HelpTip';
import { IMPORTANCE_HELP, importanceTier, importanceTitle } from '@/lib/importance';
import {
  markRead,
  requestSummaries,
  setReadLater,
  setReadMany,
  setStarred,
} from '@/app/actions/articles';
import { VIEW_LABELS, type ArticleRow, type View } from '@/lib/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

/**
 * 記事リスト。ここが「大量の記事を高速に捌く」中心。
 *
 * - 行にAIの要点と重要度を出し、開かずに判断できるようにする
 * - PC: j/k で移動、m 既読、s スター、l あとで、v 元記事、Shift+A 全既読、? でヘルプ
 * - スマホ: 左スワイプで既読、右スワイプであとで
 */

/** ヘルプに出す一覧。実際の処理は onKey 側にあるので、増やしたら両方直すこと。 */
const SHORTCUTS: [string, string][] = [
  ['j / ↓', '次の記事'],
  ['k / ↑', '前の記事'],
  ['o / Enter', '開く'],
  ['Esc', '記事を閉じる'],
  ['m', '既読・未読'],
  ['s', 'スター'],
  ['l', 'あとで'],
  ['v', '元記事を新しいタブで開く'],
  ['Shift + A', '表示中をすべて既読'],
  ['/', '検索'],
  ['?', 'このヘルプ'],
];

export function ArticleList({
  articles,
  view,
  sort,
  selectedId,
  search,
}: {
  articles: ArticleRow[];
  view: View;
  sort: 'new' | 'important';
  selectedId?: string;
  search?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // キーボード操作のカーソル。
  const selectedIndex = articles.findIndex((a) => a.id === selectedId);
  const [cursor, setCursor] = useState(() => Math.max(0, selectedIndex));
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);
  // 全既読の取り消し用に、直前まで未読だった記事を覚えておく。
  const [undoIds, setUndoIds] = useState<string[] | null>(null);
  // スワイプやキー操作の結果を短い帯で知らせる。行の色は薄い変化しかないので、
  // 押した／滑らせたことが伝わらず「効いていない」と受け取られていた。
  const [flash, setFlash] = useState<string | null>(null);

  // 記事が選択され直したらカーソルを合わせる。
  // effect ではなくレンダー中に調整する（effect でやると余計な再レンダーが1往復増える）。
  const [syncedId, setSyncedId] = useState(selectedId);
  if (selectedId !== syncedId) {
    setSyncedId(selectedId);
    if (selectedIndex >= 0) setCursor(selectedIndex);
  }

  const pushParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      const qs = sp.toString();
      router.push(qs ? `/?${qs}` : '/');
    },
    [router, searchParams],
  );

  const open = useCallback(
    (id: string) => {
      pushParams((sp) => sp.set('article', id));
      // 開いた時点で既読にする（Inoreader と同じ挙動）。
      startTransition(() => void markRead(id, true));
    },
    [pushParams],
  );

  const markAll = useCallback(() => {
    // 既に既読だったものは戻す対象にしない。
    const wasUnread = articles.filter((a) => !a.state?.is_read).map((a) => a.id);
    if (wasUnread.length === 0) return;
    setUndoIds(wasUnread);
    startTransition(() => void setReadMany(articles.map((a) => a.id), true));
  }, [articles]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 入力中はショートカットを効かせない（Esc で入力から抜けるのだけ許す）。
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (typing) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ヘルプが開いている間は閉じる操作だけ受ける。
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      const current = articles[cursor];

      switch (e.key) {
        case '?':
          e.preventDefault();
          setHelpOpen(true);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case 'Escape':
          if (selectedId) {
            e.preventDefault();
            pushParams((sp) => sp.delete('article'));
          }
          break;
        case 'j':
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(cursor + 1, articles.length - 1);
          setCursor(next);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(cursor - 1, 0);
          setCursor(prev);
          rowRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'o':
        case 'Enter':
          if (current) {
            e.preventDefault();
            open(current.id);
          }
          break;
        case 'm':
          if (current) {
            e.preventDefault();
            const next = !current.state?.is_read;
            setFlash(next ? '既読にしました' : '未読に戻しました');
            startTransition(() => void markRead(current.id, next));
          }
          break;
        case 's':
          if (current) {
            e.preventDefault();
            const next = !current.state?.is_starred;
            setFlash(next ? 'スターを付けました' : 'スターを外しました');
            startTransition(() => void setStarred(current.id, next));
          }
          break;
        case 'l':
          if (current) {
            e.preventDefault();
            const next = !current.state?.read_later;
            setFlash(next ? '「あとで読む」に入れました' : '「あとで読む」から外しました');
            startTransition(() => void setReadLater(current.id, next));
          }
          break;
        case 'v':
          if (current) {
            e.preventDefault();
            window.open(current.url, '_blank', 'noopener');
          }
          break;
        case 'A':
          if (e.shiftKey) {
            e.preventDefault();
            markAll();
          }
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [articles, cursor, open, helpOpen, selectedId, pushParams, markAll]);

  const unreadCount = articles.filter((a) => !a.state?.is_read).length;

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <header className="border-b border-zinc-800 px-3 py-2">
        {/* どのビューを見ているかを常に出す。スマホでは下部タブしか手がかりが無かった。 */}
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{VIEW_LABELS[view]}</h2>
          <span className="text-xs text-zinc-500">
            {articles.length}件{unreadCount > 0 && ` / 未読 ${unreadCount}`}
          </span>

          {view === 'unsummarized' ? (
            <button
              type="button"
              disabled={articles.length === 0}
              onClick={() =>
                startTransition(async () => {
                  // 結果を捨てない。捨てると、無料枠切れも未ログインも
                  // 「押しても何も起きない」として同じに見える。
                  const r = await requestSummaries(articles.map((a) => a.id));
                  setFlash(r.ok ? '再要約を受け付けました。順に処理されます。' : r.message);
                })
              }
              className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            >
              まとめて再要約
            </button>
          ) : (
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={markAll}
              className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            >
              全既読
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {/* 検索はサーバ側に前からあったが、入力欄が無くて使えなかった。 */}
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              pushParams((sp) => {
                const value = String(q ?? '').trim();
                if (value) sp.set('q', value);
                else sp.delete('q');
                sp.delete('article');
              });
            }}
          >
            <input
              ref={searchRef}
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="検索（/ で移動）"
              aria-label="記事を検索"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </form>

          <select
            value={sort}
            aria-label="並び順"
            title={sort === 'important' ? IMPORTANCE_HELP : undefined}
            onChange={(e) => pushParams((sp) => (sp.set('sort', e.target.value), sp.delete('article')))}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
          >
            <option value="new">新着順</option>
            <option value="important">重要度順</option>
          </select>

          {/* 重要度で並べているときだけ、その点数が何なのかを引ける「?」を出す。
              キーボードヘルプの ? と紛れないよう、説明する対象の隣に置く。 */}
          {sort === 'important' && <HelpTip label="重要度とは" text={IMPORTANCE_HELP} />}

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="キーボードショートカット"
            title="キーボードショートカット（?）"
            className="hidden md:block rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
          >
            ?
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto thin-scroll pb-16 md:pb-0">
        {articles.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">
            {search
              ? `「${search}」に一致する記事はありません`
              : view === 'unread'
                ? '未読はありません'
                : view === 'unsummarized'
                  ? '要約が付いていない記事はありません'
                  : '記事がありません'}
          </p>
        )}

        {articles.map((article, i) => (
          <Row
            key={article.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            article={article}
            active={i === cursor}
            selected={article.id === selectedId}
            onFocus={() => setCursor(i)}
            onOpen={() => {
              setCursor(i);
              open(article.id);
            }}
            onFlash={setFlash}
          />
        ))}

        {/* 上限に当たっているなら黙って切らない。 */}
        {articles.length >= 60 && (
          <p className="px-3 py-4 text-center text-xs text-zinc-600">
            先頭60件まで表示しています。絞り込むか検索してください。
          </p>
        )}
      </div>

      {undoIds && (
        <UndoBar
          count={undoIds.length}
          onUndo={() => {
            const ids = undoIds;
            setUndoIds(null);
            startTransition(() => void setReadMany(ids, false));
          }}
          onDismiss={() => setUndoIds(null)}
        />
      )}

      {/* 全既読の取り消し帯が出ているときは、そちらを優先して重ねない。 */}
      {flash && !undoIds && <ActionFlash text={flash} onDismiss={() => setFlash(null)} />}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** 全既読の取り消し。数秒で自分から消える。 */
function UndoBar({
  count,
  onUndo,
  onDismiss,
}: {
  count: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="absolute inset-x-3 bottom-20 z-20 flex items-center gap-3 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg md:bottom-4"
    >
      <span className="flex-1">{count}件を既読にしました</span>
      <button type="button" onClick={onUndo} className="font-semibold text-sky-400 hover:text-sky-300">
        取り消す
      </button>
      <button type="button" onClick={onDismiss} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-300">
        ✕
      </button>
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="キーボードショートカット"
      onClick={onClose}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded border border-zinc-700 bg-zinc-900 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-baseline gap-3">
              <dt className="w-24 shrink-0 text-right">
                <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{keys}</kbd>
              </dt>
              <dd className="text-xs text-zinc-400">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Row({
  ref,
  article,
  active,
  selected,
  onOpen,
  onFocus,
  onFlash,
}: {
  ref: (el: HTMLElement | null) => void;
  article: ArticleRow;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
  onFocus: () => void;
  /** スワイプで何をしたかを親に伝え、帯で出してもらう。 */
  onFlash: (text: string) => void;
}) {
  const [, startTransition] = useTransition();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipe, setSwipe] = useState(0);
  const [releasing, setReleasing] = useState(false);

  const read = article.state?.is_read ?? false;
  const importance = article.summary?.importance;
  // 訳した見出し（0023）。無ければ原題のまま。
  const heading = article.summary?.title_ja?.trim() || article.title;

  // 何が起きるかをスワイプ中に見せる。滑るだけだと壊れて見える。
  const THRESHOLD = 80;
  const willAct = Math.abs(swipe) > THRESHOLD;
  const leftAction = swipe < 0; // 左へ = 既読

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
          {leftAction ? (read ? '未読に戻す' : '既読にする') : article.state?.read_later ? 'あとでを外す' : 'あとで読む'}
        </div>
      )}

      <article
        ref={ref}
        tabIndex={0}
        role="button"
        aria-current={selected ? 'true' : undefined}
        onFocus={onFocus}
        onClick={onOpen}
        onKeyDown={(e) => {
          // 行そのものにフォーカスがあるとき用。全体のショートカットとは別。
          if (e.key === ' ') {
            e.preventDefault();
            onOpen();
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
            startTransition(() => void markRead(article.id, !read));
          } else if (dx > THRESHOLD) {
            const next = !article.state?.read_later;
            onFlash(next ? '「あとで読む」に入れました' : '「あとで読む」から外しました');
            startTransition(() => void setReadLater(article.id, next));
          }
        }}
        style={swipe !== 0 ? { transform: `translateX(${swipe}px)` } : undefined}
        className={`relative cursor-pointer px-3 py-2.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-500 ${
          releasing ? 'transition-transform duration-150' : ''
        } ${
          selected
            ? 'bg-zinc-800'
            : active
              ? 'bg-zinc-900 shadow-[inset_2px_0_0_0_var(--color-sky-500)]'
              : 'bg-zinc-950 hover:bg-zinc-900/60'
        }`}
      >
        <div className="flex items-start gap-2">
          {!read && (
            <span aria-label="未読" className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" />
          )}
          {/*
            訳した見出しがあればそれを主にする。記事の42%（1262件中531件）が
            英語のフィードで、原題のままだと一覧を目で追うのが重い。
            原題は捨てずに下に小さく残す（訳が的外れなときに気づけるように）。
          */}
          <h3 className={`flex-1 text-sm leading-snug ${read ? 'text-zinc-500' : 'font-medium'}`}>
            {heading}
            {heading !== article.title && (
              <span className="mt-0.5 block text-[11px] font-normal text-zinc-600">
                {article.title}
              </span>
            )}
          </h3>
          {typeof importance === 'number' && importanceTier(importance).badge && (
            <span
              title={importanceTitle(importance)}
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${importanceTier(importance).className}`}
            >
              重要度 {importanceTier(importance).label}
            </span>
          )}
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

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-600">
          <span className="truncate">{article.feed?.title}</span>
          {article.published_at && (
            <time dateTime={article.published_at}>
              {new Date(article.published_at).toLocaleDateString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
              })}
            </time>
          )}
          {article.state?.is_starred && (
            <span title="スター" className="text-amber-400">
              ★
            </span>
          )}
          {article.state?.read_later && (
            <span title="あとで読む" className="text-sky-400">
              ◷
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
}
