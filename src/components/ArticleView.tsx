import { HelpTip } from '@/components/HelpTip';
import { IMPORTANCE_HELP, importanceTier, importanceTitle } from '@/lib/importance';
import { requestSummary } from '@/app/actions/articles';
import { ArticleActions } from '@/components/ArticleActions';
import { ExportButton } from '@/components/ExportButton';
import { ActionForm } from '@/components/ActionForm';
import { MediaButton } from '@/components/MediaButton';
import Link from 'next/link';

type ArticleDetail = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string | null;
  content_text: string | null;
  /** 消毒済みの本文HTML（0019）。あればこちらを描画する。 */
  content_html: string | null;
  content_ok: boolean;
  /** 本文抽出を試みた時刻。null は未処理（0014）。 */
  extracted_at: string | null;
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; importance: number; title_ja: string | null } | null;
  article_states: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

/** 記事本文。上部にAI要約カードを固定で出し、その下に本文を置く。 */
export function ArticleView({
  article,
  backHref = '/',
  prevHref,
  nextHref,
}: {
  article: unknown;
  /** 一覧へ戻る先。絞り込みを保つため呼び出し側で組み立てて渡す。 */
  backHref?: string;
  prevHref?: string;
  nextHref?: string;
}) {
  const a = article as ArticleDetail | null;

  if (!a) {
    return (
      <div className="hidden md:flex h-full items-center justify-center text-sm text-zinc-600">
        記事を選択してください
      </div>
    );
  }

  const state = a.article_states;

  return (
    <div className="flex h-full flex-col min-h-0">
      <header className="flex items-center gap-1 border-b border-zinc-800 px-3 py-2">
        {/* スマホでリストへ戻る導線。PCではリストが常に見えているので不要。 */}
        <Link href={backHref} className="md:hidden rounded px-2 py-1 text-sm text-zinc-400">
          ← 一覧
        </Link>

        <ArticleActions
          articleId={a.id}
          starred={Boolean(state?.is_starred)}
          readLater={Boolean(state?.read_later)}
        />

        <ExportButton articleIds={[a.id]} exported={Boolean(state?.exported_at)} />

        <MediaButton articleId={a.id} />

        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto rounded px-2 py-1 text-sm text-zinc-500 hover:text-zinc-100"
        >
          元記事 ↗
        </a>
      </header>

      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-5 md:px-8 pb-24 md:pb-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs text-zinc-500">
            {a.feeds?.title}
            {a.author && ` / ${a.author}`}
            {a.published_at &&
              ` / ${new Date(a.published_at).toLocaleString('ja-JP', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
              })}`}
          </p>

          {/*
            本文側も訳した見出しを主にする。一覧と見出しが変わると、
            同じ記事を開いた気がしない。原題は下に小さく残す。
          */}
          <h1 className="mt-2 text-xl font-bold leading-snug md:text-2xl">
            {a.summaries?.title_ja?.trim() || a.title}
          </h1>
          {a.summaries?.title_ja?.trim() && a.summaries.title_ja.trim() !== a.title && (
            <p className="mt-1 text-sm text-zinc-500">{a.title}</p>
          )}

          {/* AI要約カード。 */}
          {a.summaries?.bullets?.length ? (
            <section className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-400">AI要約</span>
                <span
                  title={importanceTitle(a.summaries.importance)}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${importanceTier(a.summaries.importance).className}`}
                >
                  重要度 {importanceTier(a.summaries.importance).label}
                  <span className="ml-1 opacity-60">{a.summaries.importance}/100</span>
                </span>
                {/* 数字だけでは何の点数か分からない。押したときだけ基準を出す。 */}
                <HelpTip label="重要度とは" text={IMPORTANCE_HELP} />
              </div>
              <ul className="space-y-1">
                {a.summaries.bullets.map((b, i) => (
                  <li key={i} className="text-sm leading-relaxed text-zinc-300">
                    ・{b}
                  </li>
                ))}
              </ul>
              {a.summaries.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.summaries.tags.map((t) => (
                    <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <ActionForm action={requestSummary.bind(null, a.id)} className="mt-4">
              <button
                type="submit"
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100"
              >
                AI要約を生成する
              </button>
            </ActionForm>
          )}

          {/* 本文が空なら、抽出に失敗したのではなく保持期間を過ぎて消したほう。
              取得失敗と同じ文言を出すと原因を取り違えるので分けている。 */}
          {!a.content_text?.trim() ? (
            <p className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
              保持期間を過ぎたため本文は削除されています。元記事で読んでください。
            </p>
          ) : (
            !a.content_ok &&
            // 「まだ取りに行っていない」と「取りに行って取れなかった」は別物。
            // 前者は待てば直るので、諦めさせない書き方にする（0014）。
            (a.extracted_at ? (
              <p className="mt-4 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-300">
                このサイトからは本文を取得できなかったため、RSSの抜粋のみ表示しています。
                全文は元記事で読んでください。
              </p>
            ) : (
              <p className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
                本文はまだ取得していません（順番待ち）。しばらくすると全文と要約が入ります。
              </p>
            ))
          )}

          {/* HTML があればそちらを出す。画像・図表・動画・リンクが生きる。
              中身は保存する前に消毒してある（lib/feeds/sanitize.ts）。許可した
              タグと属性しか通っておらず、iframe は動画サイトだけに絞ってある。
              古い記事は HTML を持たないので、そのときは従来どおりテキストを出す。 */}
          {a.content_html ? (
            <div
              className="prose-rich mt-5 text-[15px] text-zinc-300"
              dangerouslySetInnerHTML={{ __html: a.content_html }}
            />
          ) : (
            <div className="prose-article mt-5 text-[15px] text-zinc-300">
              {a.content_text ?? ''}
            </div>
          )}

          {/* 読み終わったところに次への導線を置く。PCは j/k があるが、
              スマホには一覧へ戻る以外の手段が無かった。 */}
          {(prevHref || nextHref) && (
            <nav className="mt-8 flex gap-2 border-t border-zinc-800 pt-4 text-sm">
              {prevHref ? (
                <Link
                  href={prevHref}
                  className="flex-1 rounded border border-zinc-800 px-3 py-2 text-zinc-400 hover:text-zinc-100"
                >
                  ← 前の記事
                </Link>
              ) : (
                <span className="flex-1" />
              )}
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="flex-1 rounded border border-zinc-800 px-3 py-2 text-right text-zinc-400 hover:text-zinc-100"
                >
                  次の記事 →
                </Link>
              ) : (
                <span className="flex-1" />
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
