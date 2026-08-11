'use client';

import { createExport, type ExportResult } from '@/app/actions/exports';
import { safeFileName } from '@/lib/export/markdown';
import { useState, useTransition } from 'react';

/**
 * 「NotebookLM へ」ボタン。
 *
 * 押すと Markdown を組み立て、受け渡し方法を選べるダイアログを出す。
 * NotebookLM には公開APIが無いので、最後のひと手間（ソースの追加）は
 * NotebookLM 側で人がやる。こちらはそこまでを最短にする。
 */
export function ExportButton({
  articleIds,
  exported,
}: {
  articleIds: string[];
  exported?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        setResult(await createExport(articleIds));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending || articleIds.length === 0}
        className={`rounded px-2 py-1 text-sm disabled:opacity-50 ${
          exported ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-100'
        }`}
      >
        {pending ? '作成中…' : 'NotebookLM へ'}
      </button>

      {error && <span className="text-xs text-red-400">{error}</span>}

      {result && <ExportDialog result={result} onClose={() => setResult(null)} />}
    </>
  );
}

function ExportDialog({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const [copied, setCopied] = useState<'md' | 'prompt' | null>(null);

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
        </div>

        {/* 音声の出来はこの指示文でだいぶ変わるので、目立つ位置に置く。 */}
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

        <div className="mt-4 flex gap-2">
          <a
            href="https://notebooklm.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded border border-zinc-700 px-3 py-2 text-center text-sm"
          >
            NotebookLM を開く ↗
          </a>
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm text-zinc-500">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
