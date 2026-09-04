import { requestSummary } from '@/app/actions/articles';
import { ArticleActions } from '@/components/ArticleActions';
import { ArticleNav } from '@/components/ArticleNav';
import { ArticleSwipe } from '@/components/ArticleSwipe';
import { ExportButton } from '@/components/ExportButton';
import { ActionForm } from '@/components/ActionForm';
import { MarkReadOnView } from '@/components/MarkReadOnView';
import { MediaButton } from '@/components/MediaButton';
import { ShareButton } from '@/components/ShareButton';
import { ArticleMobileMenu } from '@/components/ArticleMobileMenu';
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
  /** 取れなかった理由（0028）。空なら「取れた」か「まだ試していない」。 */
  extract_fail: string | null;
  /** こちらへ入ってきた時刻。記事の日付（published_at）とはずれる。 */
  created_at: string | null;
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; title_ja: string | null } | null;
  article_states: {
    is_read: boolean;
    is_starred: boolean;
    read_later: boolean;
    exported_at: string | null;
  } | null;
};

/**
 * 本文が無いときに出す一言。
 *
 * 理由が違えば読む人の次の行動も違う（待てばよいのか、元記事へ行くのか、
 * そもそも本文が存在しないのか）。`extract_fail` が入っていないときだけ
 * 「保持期間を過ぎた」——それが唯一「あったものが消えた」場合。
 */
function missingBodyMessage(reason: string | null): string {
  switch (reason) {
    case 'recycled':
      return 'このページには記事ごとの本文がありません（どの記事を開いても同じ内容が出るページでした）。元記事で読んでください。';
    case 'notfound':
      return '元のページが見つかりませんでした。削除されたか、URLが変わっています。';
    case 'blocked':
      return 'サイト側から拒否されたため、本文を取得できませんでした。元記事で読んでください。';
    case 'nonhtml':
      return 'このページは本文として読める形式ではありませんでした。元記事で読んでください。';
    case 'network':
    case 'short':
      return '本文を取得できませんでした。しばらくすると自動でもう一度取りに行きます。';
    default:
      return '保持期間を過ぎたため本文は削除されています。元記事で読んでください。';
  }
}

/** 記事本文。上部にAI要約カードを固定で出し、その下に本文を置く。 */
export function ArticleView({
  article,
  backHref = '/',
  prevHref,
  nextHref,
  remaining,
}: {
  article: unknown;
  /** 一覧へ戻る先。絞り込みを保つため呼び出し側で組み立てて渡す。 */
  backHref?: string;
  prevHref?: string;
  nextHref?: string;
  /** この記事より後ろに残っている件数。分からないときは undefined。 */
  remaining?: number;
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

  /**
   * 読み終わるのにかかる目安（分）。
   *
   * 日本語で 500字/分。**1分未満は1分**と出す（「0分」は情報にならない）。
   * 本文が取れていない記事は出さない——RSSの抜粋だけで「1分」と出すと、
   * 短い記事なのだと誤解させる。
   */
  const chars = a.content_text?.trim().length ?? 0;
  const readingMinutes = a.content_ok && chars > 0 ? Math.max(1, Math.round(chars / 500)) : null;

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 出したなら既読にする。押して開いたものは ArticleList の open が見る。 */}
      <MarkReadOnView articleId={a.id} isRead={state?.is_read ?? false} />

      {/*
        PC用操作バー（本文の上）。
        スマホでは右下のフローティングメニュー（ArticleMobileMenu）にまとめ、
        画面下端や上端の操作帯による表示面積の圧迫を解消する。
      */}
      <header className="hidden md:flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-1">
        <ArticleActions
          articleId={a.id}
          starred={Boolean(state?.is_starred)}
          readLater={Boolean(state?.read_later)}
        />

        <ExportButton articleIds={[a.id]} exported={Boolean(state?.exported_at)} />

        <MediaButton articleId={a.id} />

        {/* 共有できないブラウザでは、このボタンごと出ない（ShareButton の中で判定）。 */}
        <ShareButton title={a.summaries?.title_ja?.trim() || a.title} url={a.url} />

        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="元記事を開く"
          className="bar-button ml-auto shrink-0 whitespace-nowrap rounded text-xs text-zinc-500 hover:text-zinc-100 md:px-2 md:py-1 md:text-sm"
        >
          <span>元記事 ↗</span>
        </a>
      </header>

      {/* スマホ用の右下ハンバーガー型フローティングメニュー */}
      <ArticleMobileMenu
        articleId={a.id}
        title={a.summaries?.title_ja?.trim() || a.title}
        url={a.url}
        starred={Boolean(state?.is_starred)}
        readLater={Boolean(state?.read_later)}
        exported={Boolean(state?.exported_at)}
      />

      {/* 指で横に払うと前後の記事へ移る。スマホには一覧へ戻る以外の道が無かった。 */}
      <ArticleSwipe articleId={a.id} prevHref={prevHref} nextHref={nextHref}>
        <div
          key={a.id}
          className="flex-1 overflow-y-auto thin-scroll px-4 py-4 md:px-8 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-8"
        >
          <div className="mx-auto max-w-2xl">
            {/* スマホで一覧へ戻るリンク */}
            <div className="mb-3 md:hidden">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-100 active:bg-zinc-800"
              >
                <span>←</span>
                <span>一覧へ戻る</span>
              </Link>
            </div>
            <p className="text-xs text-zinc-500">
              {a.feeds?.title}
              {a.author && ` / ${a.author}`}
              {a.published_at &&
                ` / ${new Date(a.published_at).toLocaleString('ja-JP', {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                })}`}
              {/* 記事の日付の隣に、こちらへ入ってきた時刻。日付は書き手が打ったもので、
                  実際に読めるようになった時刻とはずれる（省庁は特に）。 */}
              {/* **読み終わるのにどれくらいか。** 要点3つで「読むかどうか」は
                  決まるが、「いま読める長さか（3分か15分か）」は分からなかった。
                  日本語はおよそ500字/分。本文が無い記事には出さない。 */}
              {readingMinutes !== null && (
                <span className="text-zinc-600">{` · ${readingMinutes}分`}</span>
              )}
              {a.created_at && (
                <span className="text-zinc-600">
                  {' · 取得 '}
                  {new Date(a.created_at).toLocaleString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </p>

            {/*
              本文側も訳した見出しを主にする。一覧と見出しが変わると、
              同じ記事を開いた気がしない。原題は下に小さく残す。
            */}
            {/* 記事の題は、本文の中の見出し（.prose-rich h2 ＝ 本文の1.4倍）より
                大きいこと。同じだと、どこからが本文の節なのか分からなくなる。 */}
            <h1 className="mt-2 text-2xl font-bold leading-snug tracking-tight md:text-3xl">
              {a.summaries?.title_ja?.trim() || a.title}
            </h1>
            {a.summaries?.title_ja?.trim() && a.summaries.title_ja.trim() !== a.title && (
              <p className="mt-1 text-sm text-zinc-500">{a.title}</p>
            )}

            {/* AI要約カード。 */}
            {a.summaries?.bullets?.length ? (
              <section className="mt-4 rounded-lg border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] p-3.5 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="size-2 rounded-full shadow-sm"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  />
                  <span className="text-xs font-semibold text-[var(--color-accent-text)]">
                    AI要約
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {a.summaries.bullets.map((b, i) => (
                    <li key={i} className="text-sm leading-relaxed text-zinc-200">
                      ・{b}
                    </li>
                  ))}
                </ul>
                {a.summaries.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {a.summaries.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-[var(--color-accent-border)] bg-zinc-900/80 px-2 py-0.5 text-[14px] text-[var(--color-accent-text)]"
                      >
                        #{t}
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

            {/* 本文が空なときの理由は1つではない。**「保持期間を過ぎた」で全部を
                まとめないこと。** 消したのではなく最初から取れていない記事が
                41件あり（漫画の各話ページのように、どの記事でも同じものが出る
                ページ）、そこに「削除されています」と出すと、あるはずのものが
                失われたように読める。理由は extract_fail が持っている（0028）。 */}
            {!a.content_text?.trim() ? (
              <p className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
                {missingBodyMessage(a.extract_fail)}
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
                // 実寸は .prose-rich が持つ（globals.css の --text-body）。
                // ここに書くと「文字の大きさ」の設定が本文にだけ効かなくなる。
                className="prose-rich mt-5 text-zinc-300"
                dangerouslySetInnerHTML={{ __html: a.content_html }}
              />
            ) : (
              <div className="prose-article mt-5 text-zinc-300">
                {a.content_text ?? ''}
              </div>
            )}
          </div>
        </div>
      </ArticleSwipe>

      {/* 前後への導線は、来た道も見るので client 側（ArticleNav）。 */}
      <ArticleNav articleId={a.id} prevHref={prevHref} nextHref={nextHref} remaining={remaining} />
    </div>
  );
}
