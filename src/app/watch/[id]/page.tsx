import { Player } from '@/components/Player';
import { SourceLinks } from '@/components/SourceLinks';
import { estimateFinishAt, formatEta } from '@/lib/media/eta';
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

  const eta = estimateFinishAt({
    status: media.status,
    doneSegments: media.doneSegments,
    totalSegments: media.totalSegments,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 p-3">
        <Link href="/listen" className="text-sm text-zinc-400">
          ← 一覧
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{media.title}</h1>
        {media.status !== 'ready' && (
          // 途中まででも聴ける。全部できるのを待たせない。
          // 残りがどれくらいかも出す（出さないと、待つか出直すかを決められない）。
          <span className="shrink-0 text-xs text-amber-500">
            生成中
            {eta && <span className="ml-1 text-zinc-500">〜{formatEta(eta)}ごろ</span>}
          </span>
        )}
        {/*
          サーバー側の音声は30日で消える（Storage の無料枠が1GBで、1本あたり
          473KB/分あるため）。手元に置きたいものは消える前に落としてもらう。
          a のままにしているのは、ダウンロードは画面遷移が要らないため。
        */}
        {/* 聴いて気になったら原文へ行けるように。無いと音声が行き止まりになる。 */}
        <SourceLinks sources={media.sources} />

        <a
          href={`/api/media/${id}/download`}
          className="shrink-0 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          ⤓ 保存
        </a>
      </header>

      <Player
        mediaId={id}
        title={media.title}
        slides={media.slides}
        segments={media.segments}
        coverUrl={media.coverUrl}
      />
    </div>
  );
}
