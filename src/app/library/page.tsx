import { AppShell } from '@/components/AppShell';
import { LIBRARY_PAGE_SIZE, listTags, searchLibrary } from '@/lib/library';
import Link from 'next/link';

/**
 * アーカイブ検索。
 *
 * リーダーの一覧が「これから読むもの」を捌く場所なのに対して、こちらは
 * 「前に読んだあれ」を掘り返す場所。既読も込みで全部を対象にし、
 * タグ・スター・書き出し済み・期間で絞る。
 *
 * 状態を全部 URL に持たせてあるので、よく使う絞り込みはブックマークできる。
 */

export const dynamic = 'force-dynamic';

const RANGES: { label: string; days?: number }[] = [
  { label: 'すべて' },
  { label: '30日', days: 30 },
  { label: '7日', days: 7 },
];

export default async function LibraryPage({ searchParams }: PageProps<'/library'>) {
  const params = await searchParams;

  const q = typeof params.q === 'string' ? params.q : '';
  const tag = typeof params.tag === 'string' ? params.tag : undefined;
  const deep = params.deep === '1';
  const starred = params.starred === '1';
  const exported = params.exported === '1';
  const days = typeof params.days === 'string' ? Number(params.days) : undefined;
  const page = typeof params.page === 'string' ? Math.max(0, Number(params.page) || 0) : 0;

  const [{ rows, hasMore }, tags] = await Promise.all([
    searchLibrary({
      q,
      deep,
      tag,
      starred,
      exported,
      days: Number.isFinite(days) ? days : undefined,
      page,
    }),
    listTags(),
  ]);

  /** 今の絞り込みを保ったまま一部だけ差し替えた URL を作る。 */
  const link = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      q: q || undefined,
      tag,
      deep: deep ? '1' : undefined,
      starred: starred ? '1' : undefined,
      exported: exported ? '1' : undefined,
      days: days ? String(days) : undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/library?${qs}` : '/library';
  };

  return (
    <AppShell>
      <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-3xl space-y-5 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/" prefetch={true} className="text-sm text-zinc-400">
            ← 一覧
          </Link>
          <h1 className="text-xl font-bold">アーカイブ</h1>
          {/* スマホには下部タブしか無いので、二次画面どうしを相互に張っておく。 */}
          <Link href="/exports" prefetch={true} className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">
            書き出し
          </Link>
          <Link href="/settings" prefetch={true} className="text-xs text-zinc-500 hover:text-zinc-200">
            設定
          </Link>
        </div>

        {/* 検索。GET のフォームなので、結果の URL がそのまま共有・ブックマークできる。 */}
        <form action="/library" method="get" className="space-y-2">
          <div className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="タイトルで検索"
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
              検索
            </button>
          </div>

          {/* 絞り込みはフォームに含める（検索語と一緒に送る）。 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="deep" value="1" defaultChecked={deep} />
              本文も探す
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="starred" value="1" defaultChecked={starred} />
              スターのみ
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="exported" value="1" defaultChecked={exported} />
              書き出し済みのみ
            </label>
            <select
              name="days"
              defaultValue={days ? String(days) : ''}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            >
              {RANGES.map((r) => (
                <option key={r.label} value={r.days ?? ''}>
                  {r.label}
                </option>
              ))}
            </select>
            {tag && <input type="hidden" name="tag" value={tag} />}
          </div>

          <p className="text-xs text-zinc-600">
            本文の検索は索引が無いので、記事が増えると重くなります（本文は保持期間を過ぎると
            消えるため、古い記事はタイトルでしか引けません）。
          </p>
        </form>

        {/* タグ。要約のたびに Gemini が付けるので、よく出るものだけ並べる。 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tag && (
              <Link
                href={link({ tag: undefined, page: undefined })}
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-900"
              >
                {tag} ✕
              </Link>
            )}
            {tags
              .filter((t) => t.tag !== tag)
              .map((t) => (
                <Link
                  key={t.tag}
                  href={link({ tag: t.tag, page: undefined })}
                  className="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                >
                  {t.tag}
                  <span className="ml-1 text-zinc-600">{t.count}</span>
                </Link>
              ))}
          </div>
        )}

        {/* 結果 */}
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="rounded border border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
              見つかりませんでした。
              {!deep && q && '「本文も探す」を入れると範囲が広がります。'}
            </p>
          )}

          {rows.map((a) => (
            <article key={a.id} className="rounded border border-zinc-800 p-3">
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 text-sm font-medium">
                  <Link href={`/?view=all&article=${a.id}`} className="hover:underline">
                    {a.title}
                  </Link>
                </h2>
              </div>

              <p className="mt-1 text-xs text-zinc-600">
                {[a.feed?.title, a.author, a.published_at ? formatDate(a.published_at) : null]
                  .filter(Boolean)
                  .join(' / ')}
                {a.state?.is_starred && <span className="ml-1.5 text-amber-400">★</span>}
                {a.state?.exported_at && <span className="ml-1.5 text-emerald-400">書き出し済み</span>}
              </p>

              {a.summary?.bullets?.length ? (
                <ul className="mt-2 space-y-0.5">
                  {a.summary.bullets.map((b, i) => (
                    <li key={i} className="text-xs leading-relaxed text-zinc-400">
                      ・{b}
                    </li>
                  ))}
                </ul>
              ) : (
                a.excerpt && <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{a.excerpt}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(a.summary?.tags ?? []).map((t) => (
                  <Link
                    key={t}
                    href={link({ tag: t, page: undefined })}
                    className="rounded-full border border-zinc-800 px-2 py-0.5 text-[13px] text-zinc-500 hover:text-zinc-200"
                  >
                    {t}
                  </Link>
                ))}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs text-zinc-500 hover:text-zinc-200"
                >
                  元記事 ↗
                </a>
              </div>
            </article>
          ))}
        </div>

        {/* 送り。件数を数えると重いので「次があるか」だけ見る。 */}
        {(page > 0 || hasMore) && (
          <div className="flex items-center justify-between text-sm">
            {page > 0 ? (
              <Link href={link({ page: page > 1 ? String(page - 1) : undefined })} className="text-zinc-400">
                ← 前
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-zinc-600">
              {page * LIBRARY_PAGE_SIZE + 1}–{page * LIBRARY_PAGE_SIZE + rows.length}
            </span>
            {hasMore ? (
              <Link href={link({ page: String(page + 1) })} className="text-zinc-400">
                次 →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
        </div>
      </main>
    </AppShell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ja-JP');
}
