'use client';

import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import { getExport } from '@/app/actions/exports';
import { ExportDialog } from '@/components/ExportDialog';
import { MediaButton } from '@/components/MediaButton';
import type { ExportResult } from '@/lib/export/create';
import { useState, useTransition } from 'react';

export type ExportSummary = {
  id: string;
  kind: 'manual' | 'digest';
  title: string;
  created_at: string;
  article_count: number;
  /** ダイジェストなら、その日のぶんの id。自前音声にするときに要る。 */
  digest_id?: string | null;
};

/**
 * 書き出しの履歴。行を押すと Markdown を取りに行き、
 * 書き出した直後と同じ受け渡しダイアログを開く。
 *
 * 朝のダイジェストはここに溜まる。通勤前に開いて .md を落とすか
 * コピーして NotebookLM に入れる、というのが想定の使い方。
 */
export function ExportList({ exports }: { exports: ExportSummary[] }) {
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (id: string) => {
    setError(null);
    setOpenId(id);
    startTransition(async () => {
      try {
        const r = await getExport(id);
        if (!r.ok) return setError(r.message);
        setResult(r.value);
      } catch {
        setError(UNEXPECTED_ERROR);
        setOpenId(null);
      }
    });
  };

  if (exports.length === 0) {
    return (
      <p className="rounded border border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
        まだ書き出しがありません。記事を選んで「NotebookLM へ」を押すか、
        設定した時刻に毎朝のダイジェストができるのを待ってください。
      </p>
    );
  }

  return (
    <>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      <ul className="divide-y divide-zinc-900 rounded border border-zinc-800">
        {exports.map((e) => (
          <li key={e.id} className="px-3 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => open(e.id)}
                disabled={pending && openId === e.id}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <p className="truncate text-sm">
                  {e.kind === 'digest' && (
                    <span className="mr-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] text-zinc-300">
                      朝
                    </span>
                  )}
                  {e.title}
                </p>
                <p className="text-xs text-zinc-600">
                  {formatDateTime(e.created_at)} / {e.article_count}件
                </p>
              </button>

              <span className="shrink-0 text-xs text-zinc-500">
                {pending && openId === e.id ? '読込中…' : 'NotebookLM へ'}
              </span>
            </div>

            {/* NotebookLM に渡す代わりに、アプリ内で音声にすることもできる。 */}
            {e.digest_id && (
              <div className="mt-1 flex items-center gap-2">
                <MediaButton digestId={e.digest_id} label="アプリ内で音声にする" short="音声にする" />
              </div>
            )}
          </li>
        ))}
      </ul>

      {result && <ExportDialog result={result} onClose={() => setResult(null)} />}
    </>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
