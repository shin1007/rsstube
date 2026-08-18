'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { exportToDrive } from '@/app/actions/drive';
import type { ExportResult } from '@/lib/export/create';
import { safeFileName } from '@/lib/export/markdown';
import { useState, useTransition } from 'react';

/**
 * 書き出した Markdown の受け渡しダイアログ。
 *
 * NotebookLM には公開APIが無いので、最後のひと手間（ソースの追加）は人がやる。
 * こちらの仕事はダウンロード / コピー / 指示文をひと画面に並べて、
 * その手間を最小にすること。書き出した直後にも `/exports` からも同じものを出す。
 */
export function ExportDialog({
  result,
  onClose,
}: {
  result: ExportResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'md' | 'prompt' | null>(null);
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saveToDrive = () => {
    setDriveError(null);
    startTransition(async () => {
      try {
        const file = await exportToDrive(result.id);
        // 未接続なら、その旨がそのまま出る（設定画面から繋いでもらう）。
        if (!file.ok) return setDriveError(file.message);
        setDriveUrl(file.value.url);
      } catch {
        setDriveError(UNEXPECTED_ERROR);
      }
    });
  };

  const copy = async (text: string, which: 'md' | 'prompt') => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const download = () => {
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(result.title)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-0 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl md:rounded-xl border border-zinc-800 bg-zinc-950 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">NotebookLM に渡す</h2>
        <p className="mt-1 text-xs text-zinc-500">{result.title}</p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={download}
            className="w-full rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900"
          >
            .md をダウンロード
          </button>
          <button
            type="button"
            onClick={() => copy(result.markdown, 'md')}
            className="w-full rounded border border-zinc-700 px-3 py-2 text-sm"
          >
            {copied === 'md' ? 'コピーしました' : '本文をクリップボードにコピー'}
          </button>

          {/* Drive に置くと、NotebookLM 側は「ソースを追加 → ドライブ → 選ぶ」で済む。
              落として上げ直す手間が2つ減るので、繋いであるならこちらが本命。 */}
          <button
            type="button"
            onClick={saveToDrive}
            disabled={pending || Boolean(driveUrl)}
            className="w-full rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50"
          >
            {pending ? 'Drive に保存中…' : driveUrl ? 'Drive に保存しました' : 'Google Drive に保存'}
          </button>

          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-zinc-400 underline"
            >
              保存したドキュメントを開く ↗
            </a>
          )}
          {driveError && <p className="text-xs text-amber-500">{driveError}</p>}
        </div>

        {/* 音声の出来はこの指示文でだいぶ変わるので、目立つ位置に置く。 */}
        {result.prompt && (
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-xs font-semibold text-zinc-400">
              「音声概要をカスタマイズ」に貼る指示文
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{result.prompt}</p>
            <button
              type="button"
              onClick={() => copy(result.prompt, 'prompt')}
              className="mt-2 rounded border border-zinc-700 px-2 py-1 text-xs"
            >
              {copied === 'prompt' ? 'コピーしました' : '指示文をコピー'}
            </button>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <a
            href="https://notebooklm.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded border border-zinc-700 px-3 py-2 text-center text-sm"
          >
            NotebookLM を開く ↗
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-sm text-zinc-500"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
