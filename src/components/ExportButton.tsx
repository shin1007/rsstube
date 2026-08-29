'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { createExport } from '@/app/actions/exports';
import { ExportDialog } from '@/components/ExportDialog';
import type { ExportResult } from '@/lib/export/create';
import { useState, useTransition } from 'react';

/**
 * 狭い画面で出す記号（U+25A4「横線の入った四角」＝書き出した文書）。
 *
 * はじめは上向きの矢印（U+2934）にしていたが、**16px だと隣の ♪ と見分けが付かない**
 * （44px まで大きくすれば別物だと分かる、という程度の差しかない）。
 * 小さく並べる記号は、線の向きではなく形そのものが違うものを選ぶこと。
 * 矢印は ↗（元記事）でも使っていて、そちらとも紛れる。
 *
 * ソースで読めるように、記号そのものではなくエスケープで書いてある。
 */
const EXPORT_ICON = '\u25A4';

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
            {/* 狭い画面では記号だけにする。「NotebookLM へ」は12文字あり、
                これ1つで上の帯が2行になっていた。意味は aria-label が持つ。 */}
            <span className="md:hidden">{EXPORT_ICON}</span>
            <span className="hidden md:inline">NotebookLM へ</span>
          </>
        )}
      </button>

      {error && <span className="text-xs text-red-400">{error}</span>}

      {result && <ExportDialog result={result} onClose={() => setResult(null)} />}
    </>
  );
}
