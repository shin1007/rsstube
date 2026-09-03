'use client';

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { setReadLater, setStarred } from '@/app/actions/articles';
import { createExport } from '@/app/actions/exports';
import { requestArticleMedia } from '@/app/actions/media';
import { ExportDialog } from '@/components/ExportDialog';
import type { ExportResult } from '@/lib/export/create';
import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import Link from 'next/link';

const NO_SUBSCRIBE = () => () => {};

export function ArticleMobileMenu({
  articleId,
  title,
  url,
  starred,
  readLater,
  exported,
}: {
  articleId: string;
  title: string;
  url: string;
  starred: boolean;
  readLater: boolean;
  exported?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [starState, setStarState] = useState(starred);
  const [laterState, setLaterState] = useState(readLater);
  const [flash, setFlash] = useState<string | null>(null);

  // 音声化用
  const [mediaPending, startMediaTransition] = useTransition();
  const [mediaResult, setMediaResult] = useState<{ id: string; message: string } | null>(null);

  // NotebookLM エクスポート用
  const [exportPending, startExportTransition] = useTransition();
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  // Web Share API 対応判定
  const canShare = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );

  const menuRef = useRef<HTMLDivElement>(null);

  // メニューの外側をタップしたら閉じる
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  // フラッシュメッセージの自動消去
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timer);
  }, [flash]);

  // スター切り替え
  const handleToggleStar = async () => {
    const next = !starState;
    setStarState(next);
    setFlash(next ? '★ スターを付けました' : 'スターを外しました');
    try {
      await setStarred(articleId, next);
    } catch {
      setStarState(!next);
      setFlash('保存できませんでした');
    }
  };

  // あとで読む切り替え
  const handleToggleLater = async () => {
    const next = !laterState;
    setLaterState(next);
    setFlash(next ? '◷ 「あとで読む」に追加しました' : '「あとで読む」から外しました');
    try {
      await setReadLater(articleId, next);
    } catch {
      setLaterState(!next);
      setFlash('保存できませんでした');
    }
  };

  // 共有
  const handleShare = async () => {
    if (!canShare) return;
    try {
      await navigator.share({ title, url });
      setOpen(false);
    } catch {
      // ignore
    }
  };

  // 音声作成
  const handleMedia = () => {
    startMediaTransition(async () => {
      try {
        const res = await requestArticleMedia(articleId);
        if (res.ok) {
          setMediaResult({ id: res.id, message: res.message });
          setFlash(res.message);
        } else {
          setFlash(res.message);
        }
      } catch {
        setFlash('音声化を受け付けられませんでした');
      }
    });
  };

  // NotebookLM へ書き出し
  const handleExport = () => {
    startExportTransition(async () => {
      try {
        const res = await createExport([articleId]);
        if (res.ok) {
          setExportResult(res.value);
          setOpen(false);
        } else {
          setFlash(res.message);
        }
      } catch {
        setFlash(UNEXPECTED_ERROR);
      }
    });
  };

  return (
    <>
      {/* 操作フィードバックのトースト */}
      {flash && (
        <div
          role="status"
          className="fixed bottom-20 inset-x-4 z-40 mx-auto max-w-xs rounded-lg border border-zinc-700 bg-zinc-800/95 px-3 py-2 text-center text-xs shadow-xl text-zinc-100"
        >
          {flash}
          {mediaResult && (
            <Link
              href={`/watch/${mediaResult.id}`}
              className="ml-2 underline text-[var(--color-accent-text)]"
            >
              開く
            </Link>
          )}
        </div>
      )}

      {/* 書き出しダイアログ */}
      {exportResult && (
        <ExportDialog result={exportResult} onClose={() => setExportResult(null)} />
      )}

      {/* 右下のフローティングハンバーガーメニュー */}
      <div ref={menuRef} className="fixed right-4 bottom-16 z-30 md:hidden flex flex-col items-end">
        {/* メニュー展開時のポップアップ */}
        {open && (
          <div className="mb-2 w-48 rounded-xl border border-zinc-800 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-md flex flex-col gap-0.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {/* スター */}
            <button
              type="button"
              onClick={handleToggleStar}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-200 transition active:scale-95"
            >
              <span className={starState ? 'text-amber-400 font-bold' : 'text-zinc-400'}>★</span>
              <span>{starState ? 'スターを外す' : 'スターを付ける'}</span>
            </button>

            {/* あとで読む */}
            <button
              type="button"
              onClick={handleToggleLater}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-200 transition active:scale-95"
            >
              <span className={laterState ? 'text-sky-400 font-bold' : 'text-zinc-400'}>◷</span>
              <span>{laterState ? '「あとで」から外す' : 'あとで読む'}</span>
            </button>

            {/* 共有 */}
            {canShare && (
              <button
                type="button"
                onClick={handleShare}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-200 transition active:scale-95"
              >
                <span className="text-zinc-400">↑</span>
                <span>共有する</span>
              </button>
            )}

            {/* NotebookLM 書き出し */}
            <button
              type="button"
              onClick={handleExport}
              disabled={exportPending}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-200 transition active:scale-95 disabled:opacity-50"
            >
              <span className={exported ? 'text-emerald-400' : 'text-zinc-400'}>▤</span>
              <span>NotebookLMへ</span>
            </button>

            {/* 音声化 */}
            <button
              type="button"
              onClick={handleMedia}
              disabled={mediaPending}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-200 transition active:scale-95 disabled:opacity-50"
            >
              <span className="text-zinc-400">♪</span>
              <span>{mediaPending ? '処理中…' : '音声にする'}</span>
            </button>

            {/* 元記事リンク */}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-left hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition active:scale-95 border-t border-zinc-800/80 mt-0.5 pt-1.5"
            >
              <span>↗</span>
              <span>元記事を開く</span>
            </a>
          </div>
        )}

        {/* フローティング丸型アクションボタン */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'メニューを閉じる' : '記事のメニューを開く'}
          className={`size-12 rounded-full border shadow-xl flex items-center justify-center transition-all duration-200 active:scale-90 cursor-pointer ${
            open
              ? 'border-zinc-600 bg-zinc-800 text-zinc-100 rotate-90'
              : 'border-[var(--color-accent-border)] bg-zinc-900/90 text-zinc-200 hover:text-white backdrop-blur-md hover:bg-zinc-800'
          }`}
        >
          {open ? (
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
