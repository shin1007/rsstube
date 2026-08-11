'use client';

import { moveFeed } from '@/app/actions/feeds';
import { useTransition } from 'react';
import type { FolderRow } from '@/lib/types';

/**
 * フィード1件ぶんのフォルダ移動。
 *
 * フィードは数十〜数百件並ぶので、行ごとに「移動」ボタンを置くと重い。
 * 選んだ時点で送るために、ここだけクライアント側にしている。
 */
export function FolderSelect({
  feedId,
  folders,
  current,
}: {
  feedId: string;
  folders: FolderRow[];
  current: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="フォルダ"
      defaultValue={current ?? ''}
      disabled={pending}
      onChange={(e) => {
        const folderId = e.target.value;
        startTransition(async () => {
          const formData = new FormData();
          formData.set('folder_id', folderId);
          await moveFeed(feedId, formData);
        });
      }}
      className="max-w-32 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 disabled:opacity-50"
    >
      <option value="">未分類</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
