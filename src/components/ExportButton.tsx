'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
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
        const r = await createExport(articleIds);
        if (!r.ok) return setError(r.message);
        setResult(r.value);
      } catch {
        setError(UNEXPECTED_ERROR);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending || articleIds.length === 0}
        aria-label="NotebookLM へ書き出す"
        className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs disabled:opacity-50 md:text-sm ${
          exported ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-100'
        }`}
      >
        {pending ? (
          '作成中…'
        ) : (
          <>
            {/* 狭い画面では短い形にする。「NotebookLM へ」は12文字あり、
                これ1つで上の帯が2行になっていた。 */}
            <span className="md:hidden">書き出し</span>
            <span className="hidden md:inline">NotebookLM へ</span>
          </>
        )}
      </button>

      {error && <span className="text-xs text-red-400">{error}</span>}

      {result && <ExportDialog result={result} onClose={() => setResult(null)} />}
    </>
  );
}
