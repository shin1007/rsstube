'use client';

import { setFolderWeight } from '@/app/actions/feeds';
import { FOLDER_WEIGHTS, folderWeightLabel } from '@/lib/importance';
import { useState, useTransition } from 'react';

/**
 * フォルダ1件ぶんの重み。毎朝ダイジェストの選抜だけに効く（0036）。
 *
 * FolderSelect と同じで、選んだ時点で送る。押して確定するボタンを増やすと、
 * 行に並ぶものが多すぎて名前の入力欄が潰れる。
 *
 * Server Action の失敗は「押しても何も起きない」に化けるので、ここは
 * ActionForm を使えないぶん、自分で一言出す（docs/traps/db.md）。
 */
export function FolderWeightSelect({
  id,
  weight,
}: {
  id: string;
  /** 保存済みの値。列が無い/null のときは既定に寄せて渡すこと。 */
  weight: number;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // 保存済みの値が選択肢に無いときは、その値そのものを選択肢として足す。
  // 無いまま表示すると select が勝手に先頭（「出さない」）を選び、
  // 触っていないのに設定を変えたように見える。
  const options = FOLDER_WEIGHTS.some((w) => w.value === weight)
    ? FOLDER_WEIGHTS
    : [...FOLDER_WEIGHTS, { value: weight, label: folderWeightLabel(weight) }].sort(
        (a, b) => a.value - b.value,
      );

  return (
    <span className="shrink-0">
      <select
        aria-label="ダイジェストでの重み"
        title="毎朝ダイジェストに選ばれやすさ。一覧の並び順には効きません。"
        defaultValue={String(weight)}
        disabled={pending}
        onChange={(e) => {
          const next = Number(e.target.value);
          setFailed(false);
          startTransition(async () => {
            const r = await setFolderWeight(id, next);
            if (!r.ok) setFailed(true);
          });
        }}
        className="max-w-28 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 disabled:opacity-50"
      >
        {options.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
      {failed && <span className="ml-1 text-xs text-red-400">保存できませんでした</span>}
    </span>
  );
}

