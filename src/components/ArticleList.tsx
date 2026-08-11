'use client';

import {
  markAllRead,
  markRead,
  requestSummaries,
  setReadLater,
  setStarred,
} from '@/app/actions/articles';
import type { ArticleRow, View } from '@/lib/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

/**
 * 記事リスト。ここが「大量の記事を高速に捌く」中心。
 *
 * - 行にAIの要点と重要度を出し、開かずに判断できるようにする
 * - PC: j/k で移動、m 既読、s スター、l あとで、v 元記事、Shift+A 全既読
 * - スマホ: 左スワイプで既読、右スワイプであとで
 */
export function ArticleList({
  articles,
  view,
  sort,
  selectedId,
}: {
  articles: ArticleRow[];
  view: View;
  sort: 'new' | 'important';
  selectedId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // キーボード操作のカーソル。
  const selectedIndex = articles.findIndex((a) => a.id === selectedId);
  const [cursor, setCursor] = useState(() => Math.max(0, selectedIndex));
  const rowRefs = useRef<(HTMLElement | null)[]>([]);

  // 記事が選択され直したらカーソルを合わせる。
  // effect ではなくレンダー中に調整する（effect でやると余計な再レンダーが1往復増える）。
  const [syncedId, setSyncedId] = useState(selectedId);
  if (selectedId !== syncedId) {
    setSyncedId(selectedId);
    if (selectedIndex >= 0) setCursor(selectedIndex);
  }

  const open = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('article', id);
      router.push(`/?${sp.toString()}`);
      // 開いた時点で既読にする（Inoreader と同じ挙動）。
      startTransition(() => void markRead(id, true));
    },
    [router, searchParams],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 入力中はショートカットを効かせない。
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = articles[cursor];

      switch (e.key) {
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
            startTransition(() => void markRead(current.id, !current.state?.is_read));
          }
          break;
        case 's':
          if (current) {
            e.preventDefault();
            startTransition(() => void setStarred(current.id, !current.state?.is_starred));
          }
          break;
        case 'l':
          if (current) {
            e.preventDefault();
            startTransition(() => void setReadLater(current.id, !current.state?.read_later));
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
            startTransition(() => void markAllRead(articles.map((a) => a.id)));
          }
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [articles, cursor, open]);

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set(key, value);
    sp.delete('article');
    router.push(`/?${sp.toString()}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <select
          value={sort}
          onChange={(e) => setParam('sort', e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
        >
          <option value="new">新着順</option>
          <option value="important">重要度順</option>
        </select>

        <span className="text-xs text-zinc-500">{articles.length}件</span>

        {view === 'unsummarized' ? (
          <button
            type="button"
            disabled={articles.length === 0}
            onClick={() => startTransition(() => void requestSummaries(articles.map((a) => a.id)))}
            className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
          >
            まとめて再要約
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startTransition(() => void markAllRead(articles.map((a) => a.id)))}
            className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100"
          >
            全既読
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto thin-scroll pb-16 md:pb-0">
        {articles.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">
            {view === 'unread'
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
            onOpen={() => {
              setCursor(i);
              open(article.id);
            }}
          />
        ))}
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
}: {
  ref: (el: HTMLElement | null) => void;
  article: ArticleRow;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const [, startTransition] = useTransition();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipe, setSwipe] = useState(0);

  const read = article.state?.is_read ?? false;
  const importance = article.summary?.importance;

  return (
    <article
      ref={ref}
      onClick={onOpen}
      onTouchStart={(e) => {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
        setSwipe(0);
        touchStart.current = null;
        if (dx < -80) startTransition(() => void markRead(article.id, !read));
        else if (dx > 80)
          startTransition(() => void setReadLater(article.id, !article.state?.read_later));
      }}
      style={swipe !== 0 ? { transform: `translateX(${swipe}px)` } : undefined}
      className={`cursor-pointer border-b border-zinc-900 px-3 py-2.5 transition-colors ${
        selected ? 'bg-zinc-800' : active ? 'bg-zinc-900' : 'hover:bg-zinc-900/60'
      }`}
    >
      <div className="flex items-start gap-2">
        {!read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" />}
        <h3 className={`flex-1 text-sm leading-snug ${read ? 'text-zinc-500' : 'font-medium'}`}>
          {article.title}
        </h3>
        {typeof importance === 'number' && importance >= 70 && (
          <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-300">
            {importance}
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
          {article.excerpt ?? '要約待ち…'}
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
        {article.state?.is_starred && <span className="text-amber-400">★</span>}
        {article.state?.read_later && <span className="text-sky-400">◷</span>}
        {article.state?.exported_at && <span className="text-emerald-400">NLM</span>}
      </div>
    </article>
  );
}
