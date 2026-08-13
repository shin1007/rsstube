import { Player } from '@/components/Player';
import { getPlayable } from '@/lib/media/list';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * スライド同期の再生画面。
 *
 * 音だけ聴きたいときも同じ画面でよい（画面を消せば音声だけになり、
 * ロック画面からは MediaSession で操作できる）。プレイヤーを2つ作らない。
 */

export const dynamic = 'force-dynamic';

export default async function WatchPage({ params }: PageProps<'/watch/[id]'>) {
  const { id } = await params;
  const media = await getPlayable(id);
  if (!media) notFound();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 p-3">
        <Link href="/listen" className="text-sm text-zinc-400">
          ← 一覧
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{media.title}</h1>
        {media.status !== 'ready' && (
          // 途中まででも聴ける。全部できるのを待たせない。
          <span className="shrink-0 text-xs text-amber-500">生成中</span>
        )}
      </header>

      <Player
        mediaId={id}
        title={media.title}
        slides={media.slides}
        segments={media.segments}
      />
    </div>
  );
}
