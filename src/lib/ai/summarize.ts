import { generateJson, SUMMARY_MODEL } from './gemini';

/**
 * 記事の要約と重要度スコア。
 *
 * 一覧を開いた瞬間に「読むべきか」を判断できることが目的なので、
 * 要点は短く、記事を開かなくても意味が通る文にさせる。
 * 重要度スコアはトリアージのソートと、毎朝ダイジェストの選抜に使う。
 *
 * 無料枠のRPD(1日あたりリクエスト数)を節約するため、複数記事を
 * 1リクエストにまとめて投げる。
 */

export type SummaryInput = {
  id: string;
  title: string;
  /** 本文（抽出できていれば本文、できていなければRSSの抜粋）。 */
  text: string;
  /** false のとき、モデルに「これは抜粋である」と伝えて過剰な断定を避けさせる。 */
  contentOk: boolean;
};

export type SummaryOutput = {
  id: string;
  bullets: string[];
  tags: string[];
  importance: number;
};

/** 1リクエストにまとめる記事数。多すぎると出力が雑になるので控えめに。 */
export const BATCH_SIZE = 5;

/** 1記事あたりに渡す本文の長さ。長文をそのまま入れると入力トークンを食う。 */
const TEXT_LIMIT = 6_000;

const SCHEMA = {
  type: 'object',
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'integer' },
        },
        required: ['id', 'bullets', 'tags', 'importance'],
      },
    },
  },
  required: ['summaries'],
};

function buildPrompt(articles: SummaryInput[], language: string): string {
  const body = articles
    .map((a) => {
      const note = a.contentOk ? '' : '\n(注: 本文が取得できず、RSSの抜粋のみ)';
      return [
        `<article id="${a.id}">`,
        `タイトル: ${a.title}${note}`,
        '本文:',
        a.text.slice(0, TEXT_LIMIT),
        '</article>',
      ].join('\n');
    })
    .join('\n\n');

  return [
    'あなたはRSSリーダーの要約担当です。以下の各記事について、',
    `${language === 'ja' ? '日本語で' : `${language} で`}次を出力してください。`,
    '',
    '- bullets: 要点を2〜3個。各40〜80字程度。記事を開かなくても内容がわかる具体的な文にすること。',
    '  「〜について述べている」のようなメタな説明ではなく、何が起きたか・何が主張されているかを直接書く。',
    '- tags: 内容を表す短いタグを1〜4個。一般的な語を使い、記事ごとに揺れないようにする。',
    '- importance: 0〜100の重要度。以下を高くする基準とする。',
    '    新規性がある / 影響範囲が広い / 一次情報である / 実務や判断に使える',
    '  逆に、続報のない小ネタ、宣伝、既出の焼き直しは低くする。',
    '  50を平均とし、機械的に高得点を付けないこと。',
    '',
    '本文がRSSの抜粋のみの記事は、抜粋からわかる範囲だけを書き、推測で補わないこと。',
    'id は入力の値をそのまま返すこと。',
    '',
    body,
  ].join('\n');
}

export async function summarizeBatch(
  articles: SummaryInput[],
  language = 'ja',
): Promise<{ results: SummaryOutput[]; model: string }> {
  if (articles.length === 0) return { results: [], model: SUMMARY_MODEL };

  const data = await generateJson<{ summaries: SummaryOutput[] }>({
    model: SUMMARY_MODEL,
    prompt: buildPrompt(articles, language),
    schema: SCHEMA,
  });

  const known = new Set(articles.map((a) => a.id));
  const results = (data.summaries ?? [])
    // モデルが id を作り変えてくることがあるので、入力に無いものは捨てる。
    .filter((s) => known.has(s.id))
    .map((s) => ({
      id: s.id,
      bullets: (s.bullets ?? []).slice(0, 4).map((b) => String(b).trim()).filter(Boolean),
      tags: (s.tags ?? []).slice(0, 6).map((t) => String(t).trim()).filter(Boolean),
      importance: Math.max(0, Math.min(100, Math.round(Number(s.importance) || 50))),
    }));

  return { results, model: SUMMARY_MODEL };
}
