import { needsAttention } from '@/lib/feeds/health';
import type { SubscribedFeed } from '@/lib/subscriptions';
import { UnsubscribeButton } from '@/components/UnsubscribeButton';

/**
 * 手当てが要るフィードだけを上に出す。
 *
 * 18本を目で見て「どれが止まっているか」を判断するのは無理がある。
 * 特に「取得は成功しているのに更新が止まっている」型は、失敗回数が 0 なので
 * 一覧を眺めても分からない（実データでも MDN Blog が60日新着なしだった）。
 *
 * 何も無ければ何も出さない。正常なときに枠だけ出ていると、
 * そのうち見なくなる。
 */
export function FeedHealth({ feeds }: { feeds: SubscribedFeed[] }) {
  const problems = needsAttention(
    feeds.map((f) => ({
      ...f,
      errorCount: f.error_count,
      lastError: f.last_error,
      lastArticleAt: f.last_article_at,
      createdAt: f.created_at,
    })),
  );

  if (problems.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">
        気になるフィード（{problems.length}）
      </h2>
      <p className="mb-2 text-xs text-zinc-500">
        取れなくなったものと、取れてはいるが更新が止まっているものです。
        止まっていても実害は小さい（巡回のたびに条件付きGETが1回走るだけ）ので、
        気になったときに整理すれば十分です。
      </p>

      <ul className="divide-y divide-zinc-900 rounded border border-zinc-800">
        {problems.map(({ feed, health }) => (
          <li key={feed.id} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                  health.level === 'dead'
                    ? 'bg-red-950 text-red-300'
                    : health.level === 'failing'
                      ? 'bg-amber-950 text-amber-300'
                      : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {health.level === 'dead' ? '壊れている' : health.level === 'failing' ? '不調' : '更新なし'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{feed.title || feed.url}</span>
              <UnsubscribeButton
                feedId={feed.id}
                title={feed.title || feed.url}
                folderId={feed.folder_id}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{health.reason}</p>
            {/* 直せることもあるので、元のサイトへ行けるようにしておく
                （URLが変わっただけなら、新しいフィードを登録し直せばいい）。 */}
            <a
              href={feed.site_url ?? feed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-block text-xs text-zinc-600 hover:text-zinc-300"
            >
              サイトを見る ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
