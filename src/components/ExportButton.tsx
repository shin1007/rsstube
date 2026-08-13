'use client';

import { createExport } from '@/app/actions/exports';
import { ExportDialog } from '@/components/ExportDialog';
import type { ExportResult } from '@/lib/export/create';
import { useState, useTransition } from 'react';

/**
 * 「NotebookLM へ」ボタン。
 *
 * 押すと Markdown を組み立て、受け渡し方法を選べるダイアログを出す。
 * 作ったものは `/exports` に残るので、あとから同じダイアログを開き直せる。
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
