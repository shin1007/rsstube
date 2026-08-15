import { AppShell } from '@/components/AppShell';
import { listMedia } from '@/lib/media/list';
import Link from 'next/link';

/**
 * 音声の一覧。
 *
 * 「アプリを開くと音声が溜まっている」状態を出す場所。生成中のものも並べて
 * 進み具合を出す（8分の番組が5分でできるわけではないので、待っている間に
 * 何も出ないと壊れているのか判断できない）。
 */

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  queued: '順番待ち',
  scripting: '台本を作成中',
  synthesizing: '音声を合成中',
  ready: '',
  failed: '失敗',
};

export default async function ListenPage() {
  const media = await listMedia();

  return (
    <AppShell>
      <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400">
            ← 一覧
          </Link>
          <h1 className="text-xl font-bold">聴く</h1>
          <Link href="/exports" className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">
            書き出し
          </Link>
          <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-200">
            設定
          </Link>
        </div>

        <p className="text-xs text-zinc-500">
          記事やダイジェストから作った音声です。スライド付きで再生でき、
          画面を消しても聴けます（ロック画面から一時停止・スキップも効きます）。
          話し方（2人の対話 / 1人の語り）は設定で選べます。
        </p>
        <p className="text-xs text-zinc-600">
          サーバー上の音声は<span className="text-zinc-400">30日で消えます</span>
          （保存容量の都合。設定の「音声の保持」で変えられます）。
          残しておきたいものは「保存」から MP3 で落としてください。
        </p>

        {media.length === 0 && (
          <p className="rounded border border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
            まだありません。書き出しの画面か記事から「音声にする」を押すと作られます。
          </p>
        )}

        <ul className="space-y-2">
          {media.map((m) => {
            const busy = m.status !== 'ready' && m.status !== 'failed';
            // 途中まででも聴けるので、1つでも合成できていればリンクにする。
            const playable = m.doneSegments > 0;

            const row = (
              <>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-sm">
                    {m.kind === 'digest' && (
                      <span className="mr-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        朝
                      </span>
                    )}
                    {m.title}
                  </span>
                  {m.status === 'ready' && (
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {fmtDuration(m.durationSec)}
                    </span>
                  )}
                </div>

                {busy && (
                  <div className="mt-1.5 space-y-1">
                    <p className="text-xs text-amber-500">
                      {STATUS_LABEL[m.status]}
                      {m.totalSegments > 0 && ` — ${m.doneSegments}/${m.totalSegments}`}
                      {playable && '（できたところまで聴けます）'}
                    </p>
                    {m.totalSegments > 0 && (
                      <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full bg-amber-600"
                          style={{ width: `${(m.doneSegments / m.totalSegments) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {m.status === 'failed' && (
                  <p className="mt-1 line-clamp-2 text-xs text-red-400">{m.lastError}</p>
                )}
              </>
            );

            return (
              <li key={m.id} className="rounded border border-zinc-800">
                {playable ? (
                  <Link href={`/watch/${m.id}`} className="block p-3 hover:bg-zinc-900">
                    {row}
                  </Link>
                ) : (
                  <div className="p-3">{row}</div>
                )}
                {/* 全部できてから出す。途中のものを落としても尻切れになる。 */}
                {m.status === 'ready' && (
                  <div className="border-t border-zinc-900 px-3 py-1.5">
                    <a
                      href={`/api/media/${m.id}/download`}
                      className="text-xs text-zinc-500 hover:text-zinc-200"
                    >
                      ⤓ MP3を保存
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </div>
      </main>
    </AppShell>
  );
}

function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 1 ? '1分未満' : `${m}分`;
}
