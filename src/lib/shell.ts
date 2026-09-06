import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { FeedRow, FolderRow } from '@/lib/types';

/**
 * 全ページの外枠（サイドバーと下部タブ）が要るもの。**1往復で取る。**
 *
 * 以前はここが4本だった——`folders` / `subscriptions`+`feeds` /
 * `unread_counts()` / 未聴の数。並べて投げてはいたが、**遅いのは DB ではなく
 * PostgREST のほう**で、素の SQL では4本とも 0.5ms 前後、まとめても 2.7ms
 * しかかからない（0039 のコメント）。つまり削れるのは実行時間ではなく、
 * HTTP の往復と問い合わせの組み立てを3回ぶん。全ページで通るので常時効く。
 *
 * `cache()` で包んであるのは、1リクエストの中で AppShell と
 * ページ本体の両方から呼ばれても1回で済ませるため。リクエストをまたいでは
 * 残らないので、購読やフォルダを変えた直後から効く。
 */

export type ShellData = {
  folders: FolderRow[];
  feeds: FeedRow[];
  /** フィードごとの未読件数。フォルダぶんは呼び出し側で足す。 */
  unread: Map<string, number>;
  /** まだ一度も聴いていない音声の数（ready のものだけ）。 */
  unplayed: number;
};

type RawShell = {
  folders: FolderRow[];
  feeds: FeedRow[];
  unread: Record<string, number>;
  unplayed: number;
};

export const shellData = cache(async (): Promise<ShellData> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('shell_data');
  if (error) throw error;

  const raw = (data ?? {}) as Partial<RawShell>;

  return {
    folders: raw.folders ?? [],
    /**
     * 並べ替えはこちらでやる。フィードの並びは日本語の `localeCompare` で、
     * Postgres の照合順とは一致しない（SQL 側で order by すると見た目が変わる）。
     */
    feeds: (raw.feeds ?? []).sort((a, b) => a.title.localeCompare(b.title, 'ja')),
    unread: new Map(Object.entries(raw.unread ?? {}).map(([id, n]) => [id, Number(n)])),
    unplayed: Number(raw.unplayed ?? 0),
  };
});
