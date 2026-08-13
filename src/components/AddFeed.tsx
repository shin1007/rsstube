'use client';

import { findFeeds, subscribeFeed } from '@/app/actions/feeds';
import type { FeedCandidate } from '@/lib/feeds/discover';
import type { FolderRow } from '@/lib/types';
import { useState, useTransition } from 'react';

/**
 * フィードの追加。
 *
 * 以前は「フィードのURLを正確に知っている」前提のフォームだった。手元にあるのは
 * たいてい読んでいるページのURLなので、そのまま貼ると失敗する。ここでは
 * 何を貼っても探しに行き、見つかったものの中身（タイトルと最新3件）を見せてから
 * 登録する。登録した瞬間に記事も入るので、次の巡回を待たなくていい。
 */
export function AddFeed({ folders }: { folders: FolderRow[] }) {
  const [input, setInput] = useState('');
  const [folder, setFolder] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  const search = () => {
    setError(null);
    setMessage(null);
    setCandidates(null);
    startTransition(async () => {
      try {
        setCandidates(await findFeeds(input));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const add = (candidate: FeedCandidate) => {
    setError(null);
    setAdding(candidate.url);
    startTransition(async () => {
      try {
        const r = await subscribeFeed(candidate.url, folder);
        setMessage(
          r.newArticles > 0
            ? `「${r.title}」を登録し、記事を${r.newArticles}件取り込みました。`
            : `「${r.title}」を登録しました。記事は次の巡回で入ります。`,
        );
        setCandidates(null);
        setInput('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAdding(null);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // フォームではないので Enter を自分で拾う。
            if (e.key === 'Enter' && input.trim()) search();
          }}
          placeholder="サイトのURL（例: nazology.kusuguru.co.jp）"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="フォルダ（任意）"
          list="folder-names"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm sm:w-40"
        />
        <datalist id="folder-names">
          {folders.map((f) => (
            <option key={f.id} value={f.name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={search}
          disabled={pending || !input.trim()}
          className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-900 disabled:opacity-50"
        >
          {pending && !adding ? '探しています…' : '探す'}
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        フィードのURLでも、記事を読んでいるページのURLでも構いません。
        ページに書かれたフィードの場所を探し、見つからなければよくある場所を当たります。
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {message && <p className="text-xs text-emerald-400">{message}</p>}

      {/* 見つかったもの。登録する前に中身を見せる。 */}
      {candidates && candidates.length > 0 && (
        <ul className="divide-y divide-zinc-900 rounded border border-zinc-800">
          {candidates.map((c) => (
            <li key={c.url} className="p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="truncate text-xs text-zinc-600">{c.url}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {c.sampleTitles.map((t, i) => (
                      <li key={i} className="truncate text-xs text-zinc-500">
                        ・{t}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => add(c)}
                  disabled={pending}
                  className="shrink-0 rounded bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50"
                >
                  {adding === c.url ? '登録中…' : '登録'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
