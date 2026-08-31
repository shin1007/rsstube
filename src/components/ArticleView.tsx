import { HelpTip } from '@/components/HelpTip';
import { IMPORTANCE_HELP, importanceTier, importanceTitle } from '@/lib/importance';
import { requestSummary } from '@/app/actions/articles';
import { ArticleActions } from '@/components/ArticleActions';
import { ArticleNav } from '@/components/ArticleNav';
import { ArticleSwipe } from '@/components/ArticleSwipe';
import { ExportButton } from '@/components/ExportButton';
import { ActionForm } from '@/components/ActionForm';
import { MarkReadOnView } from '@/components/MarkReadOnView';
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
  /** 取れなかった理由（0028）。空なら「取れた」か「まだ試していない」。 */
  extract_fail: string | null;
  /** こちらへ入ってきた時刻。記事の日付（published_at）とはずれる。 */
  created_at: string | null;
  feeds: { id: string; title: string } | null;
  summaries: { bullets: string[]; tags: string[]; importance: number; title_ja: string | null } | null;
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
      {/* 出したなら既読にする。押して開いたものは ArticleList の open が見る。 */}
      <MarkReadOnView articleId={a.id} isRead={state?.is_read ?? false} />

      {/*
        操作の帯。**1行から溢れさせないこと。**
        溢れると flex が縮めにきて、`音声にする` のような日本語のラベルが
        1文字ずつ縦に折り返る（画面の1/4を帯が占めていた）。
        文字の目盛りを2段階上げたときに、それまでぎりぎり収まっていた
        6つのボタンが入らなくなって起きた。
        狭い画面では記号だけ（← / ★ / ◷ / ▤ / ♪ / ↗）にし、どのボタンにも
        whitespace-nowrap と shrink-0 を付けてある。**意味は aria-label が持つ**ので、
        読み上げには記号ではなく、いつもと同じ言葉が渡る。
        記号にして空いたぶんは上下の余白ではなく**指の当たり判定（px-3）**に回す。
      */}
      <header className="flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b border-zinc-800 px-2 py-1 md:gap-1 md:px-3">
        {/* スマホでリストへ戻る導線。PCではリストが常に見えているので不要。 */}
        <Link
          href={backHref}
          aria-label="一覧へ戻る"
          className="md:hidden shrink-0 whitespace-nowrap rounded px-3 py-1 text-xs text-zinc-400"
        >
          ←
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
          aria-label="元記事を開く"
          className="ml-auto shrink-0 whitespace-nowrap rounded px-3 py-1 text-xs text-zinc-500 hover:text-zinc-100 md:px-2 md:text-sm"
        >
          <span className="md:hidden">↗</span>
          <span className="hidden md:inline">元記事 ↗</span>
        </a>
      </header>

      {/* 指で横に払うと前後の記事へ移る。スマホには一覧へ戻る以外の道が無かった。 */}
      <ArticleSwipe articleId={a.id} prevHref={prevHref} nextHref={nextHref}>
        {/* 下の余白は 24（96px）あったが、あれは下部タブを避けるためのもので、
            記事を開いている間はそのタブが消えている。下に前後の帯が付いた今は
            本文の終わりに画面半分の空白ができるだけなので詰める。 */}
        <div className="flex-1 overflow-y-auto thin-scroll px-4 py-5 md:px-8 pb-10 md:pb-8">
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
              {/* 記事の日付の隣に、こちらへ入ってきた時刻。日付は書き手が打ったもので、
                  実際に読めるようになった時刻とはずれる（省庁は特に）。 */}
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
                    className={`rounded px-1.5 py-0.5 text-[14px] ${importanceTier(a.summaries.importance).className}`}
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
                      <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[14px] text-zinc-400">
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
                className="prose-rich mt-5 text-[19px] text-zinc-300"
                dangerouslySetInnerHTML={{ __html: a.content_html }}
              />
            ) : (
              <div className="prose-article mt-5 text-[19px] text-zinc-300">
                {a.content_text ?? ''}
              </div>
            )}
          </div>
        </div>
      </ArticleSwipe>

      {/* 前後への導線は、来た道も見るので client 側（ArticleNav）。 */}
      <ArticleNav articleId={a.id} prevHref={prevHref} nextHref={nextHref} />
    </div>
  );
}
