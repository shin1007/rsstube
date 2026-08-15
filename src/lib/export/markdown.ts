/**
 * NotebookLM に渡すための Markdown を組み立てる。
 *
 * NotebookLM は1ノートブックに入れられるソース数に上限があるので、
 * 1記事1ファイルにはせず、複数記事を1ファイルにまとめる。
 * 各記事に出典URLを必ず入れておくと、音声概要の中で
 * 「どの記事の話か」が保たれやすい。
 */

export type ExportArticle = {
  title: string;
  /**
   * 設定言語での見出し（0023）。あればこちらを主にする。
   *
   * 見出しまで原語だと、英語のフィードでは Markdown のほとんどが英語になり、
   * 指示文で「日本語で話して」と頼んでも音声が英語に引きずられる（実際になった）。
   */
  titleJa?: string | null;
  url: string;
  feedTitle?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  bullets?: string[] | null;
  contentText?: string | null;
  contentOk: boolean;
};

/** 1記事あたりの本文上限。長すぎるとNotebookLM側の取り込みが重くなる。 */
const PER_ARTICLE_LIMIT = 20_000;

export function buildMarkdown(articles: ExportArticle[], title: string): string {
  const lines: string[] = [`# ${title}（${articles.length}件）`, ''];

  articles.forEach((a, i) => {
    const meta = [a.feedTitle, a.author, a.publishedAt ? formatDate(a.publishedAt) : null]
      .filter(Boolean)
      .join(' / ');

    const heading = a.titleJa?.trim() || a.title;
    lines.push(`## ${i + 1}. ${heading}`, '');
    if (meta) lines.push(`- 出典: ${meta}`);
    // 訳した見出しを使ったときだけ原題も残す。元記事を探すときに要る。
    if (heading !== a.title) lines.push(`- 原題: ${a.title}`);
    lines.push(`- URL: ${a.url}`);

    if (a.bullets?.length) {
      lines.push(`- AI要点:`);
      for (const b of a.bullets) lines.push(`  - ${b}`);
    }

    if (!a.contentOk) {
      // 本文が取れていないことを明示しておくと、
      // NotebookLM が抜粋を全文だと誤解して話を膨らませるのを抑えられる。
      lines.push(`- 注記: 本文を取得できず、RSSの抜粋のみ`);
    }

    const body = (a.contentText ?? '').slice(0, PER_ARTICLE_LIMIT).trim();
    if (body) {
      // 本文が原語のままであることを断っておく。断らないと、素材の言語に
      // 引きずられて音声まで原語になる。見出しと要点は訳してあるので、
      // 「読むのは原語、話すのは設定言語」と明示すれば足りる。
      if (heading !== a.title) lines.push('', '- 以下の本文は原語です。要点は上のAI要点を参照。');
      lines.push('', body);
    }
    lines.push('', '---', '');
  });

  return lines.join('\n');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** ファイル名に使えない文字を落とす。 */
export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}
