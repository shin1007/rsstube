import { cacheLife } from 'next/cache';
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
 * **`"use cache: private"` にしてある。** これが付いていると、この結果は
 * Cache Components の App Shell（＝リンクを押した瞬間に出せるぶん）に入る。
 * ログインが要るアプリでも使えるのは、**結果がブラウザの中にしか置かれない**
 * から——サーバーには残らないので、他人のサイドバーが混ざる余地が無い。
 *
 * `stale` は 30 秒。Next が受け付ける下限で、これ以上短くはできない
 * （先読みしたものが使えなくなるため）。未読の数がその間だけ古くなりうるが、
 * **スター・あとで・手で付けた既読は Server Action が `revalidatePath` を
 * 呼ぶので、その場でブラウザのキャッシュごと捨てられる**（＝すぐ新しくなる）。
 * 残るのは「開いた拍子の既読」だけで、そこはもともと1件ぶん遅れる仕様
 * （docs/traps/perf.md）。
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

export async function shellData(): Promise<ShellData> {
  'use cache: private';
  cacheLife({ stale: 30 });

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
}
