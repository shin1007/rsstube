import { generateJson, SCRIPT_MODEL, type Usage } from './gemini';

/**
 * 2話者の対話台本とスライドを、1回の生成でまとめて作る。
 *
 * 分けて2回呼ばないのは、台本とスライドの切れ目が一致していないと
 * 同期再生が成立しないため。1回で出させて、各発話に「どのスライドを出しているか」を
 * 持たせれば、再生側は「クリップが終わったら次へ」を見るだけで済む。
 *
 * 話者は2人。NotebookLM の音声概要と同じ「聞き手が素朴に訊いて、話し手が答える」
 * 形にすると、専門外の内容でも耳で追える。
 */

/** 台本の1発話。スライド1枚に複数の発話がぶら下がる。 */
export type ScriptLine = {
  speaker: 'A' | 'B';
  text: string;
  /** 何枚目のスライドを出しているか（slides の添字）。 */
  slide: number;
};

export type Slide =
  | { type: 'title'; title: string; subtitle?: string }
  | { type: 'bullets'; heading: string; bullets: string[] }
  | { type: 'quote'; text: string; cite?: string };

export type ScriptResult = {
  lines: ScriptLine[];
  slides: Slide[];
  usage: Usage;
};

/** 話者の役どころ。プロンプトと TTS の声の割り当ての両方で使う。 */
export const SPEAKERS = {
  A: { name: 'アオイ', role: '進行役。話題を切り出し、要点をまとめる' },
  B: { name: 'ケン', role: '聞き手。専門外の立場から素朴な疑問を投げ、噛み砕かせる' },
} as const;

/**
 * 出力の上限。
 *
 * JSON は途中で切れると parse できず、生成そのものが丸ごと無駄になる。
 * 指示で長さを頼むだけでは効かなかった（8件のダイジェストで8万字を超える台本を
 * 書いてきて、出力の上限で切れた）ので、渡す素材の量（textLimit）と
 * maxOutputTokens、そして受け取ってからの切り詰めの3段で抑える。
 *
 * スキーマの maxItems は使えない。項目数の多いオブジェクトと組み合わせると
 * Gemini が 400 INVALID_ARGUMENT を返す（項目3つのスキーマでは通り、
 * 7つにすると落ちることを確認した）。エラー本文に理由が出ないので、
 * 足すと原因不明の400として跳ね返ってくる。
 */
const MAX_SLIDES = 12;
const MAX_LINES = 70;

/**
 * maxOutputTokens は思考トークンも含む。8192 にしたら思考だけで使い切って
 * 本文が716字で切れた。台本3000字なら本文は3000トークン前後なので、
 * 思考ぶんを別に見込んで広めに取り、思考自体も上限を決めておく。
 */
const MAX_OUTPUT_TOKENS = 24_576;
const THINKING_BUDGET = 4_096;

const SCHEMA = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['title', 'bullets', 'quote'] },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          heading: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
          cite: { type: 'string' },
        },
        required: ['type'],
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['A', 'B'] },
          text: { type: 'string' },
          slide: { type: 'integer' },
        },
        required: ['speaker', 'text', 'slide'],
      },
    },
  },
  required: ['slides', 'lines'],
};

export type ScriptSource = {
  title: string;
  /** 記事ごとの素材。ダイジェストなら複数件。 */
  articles: { title: string; url: string; bullets: string[]; text: string }[];
};

/**
 * 1記事あたりに渡す本文の長さ。
 *
 * 記事が多いほど短くする。8件に4000字ずつ渡したら、モデルが素材の量に引きずられて
 * 8万字を超える台本を書き、出力の上限で JSON が途中で切れて丸ごと壊れた。
 * ダイジェストで効くのは要点（summaries.bullets）のほうで、本文は雰囲気を掴む程度でよい。
 */
function textLimit(articleCount: number): number {
  if (articleCount <= 1) return 6_000;
  if (articleCount <= 3) return 2_500;
  return 1_000;
}

/** 1本の目安の長さ。長すぎると聴き通せないし、TTS の呼び出しも増える。 */
const TARGET_MINUTES = 8;

function buildPrompt(source: ScriptSource, extra: string): string {
  const limit = textLimit(source.articles.length);

  const body = source.articles
    .map((a, i) =>
      [
        `<article index="${i + 1}">`,
        `タイトル: ${a.title}`,
        a.bullets.length ? `要点:\n${a.bullets.map((b) => `- ${b}`).join('\n')}` : '',
        limit > 0 ? '本文（抜粋）:' : '',
        limit > 0 ? a.text.slice(0, limit) : '',
        '</article>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  return [
    'あなたはニュース番組の構成作家です。次の記事群から、2人の対話による',
    `音声番組の台本と、それに合わせて表示するスライドを作ってください。日本語で。`,
    '',
    `話者A = ${SPEAKERS.A.name}（${SPEAKERS.A.role}）`,
    `話者B = ${SPEAKERS.B.name}（${SPEAKERS.B.role}）`,
    '',
    '## 分量（守ること）',
    `- スライドは最大${MAX_SLIDES}枚、発話は最大${MAX_LINES}個。これを超えてはいけない。`,
    `- 全体で読み上げて${TARGET_MINUTES}分程度（1分あたり約350字が目安、合計3000字前後）。`,
    '- 記事が多いときは1件あたりを短くして収める。全部を深く語ろうとしないこと。',
    '',
    '## スライド',
    `- 枚数は「1（表紙）＋記事の数」。今回は素材が${source.articles.length}件なので` +
      `${Math.min(source.articles.length + 1, MAX_SLIDES)}枚にすること。1枚だけで済ませてはいけない。`,
    '- 先頭は必ず type="title" の1枚。全体の主題を出す。',
    '- 続けて記事ごとに type="bullets" を1枚ずつ。heading は記事の主題、bullets は2〜4個の短い要点。',
    '- 特に印象的な一文があれば type="quote" を挟んでよい（多用しない）。',
    '- 文字は画面で読ませるので短く。bullets は1個あたり30字以内。',
    '',
    '## 台本',
    '- lines は発話の並び。各発話に slide（そのとき表示しているスライドの添字、0始まり）を付ける。',
    '- slide は前の発話と同じか+1のみ。戻ってはいけない。スライドは必ず順に進む。',
    '- 最後のスライドまで必ず進めること。全部の発話が slide=0 のままではいけない。',
    '- ある記事の話をしている間は、その記事のスライドを指すこと。',
    '- 1発話は40〜120字程度。長い説明は相手の相槌や質問を挟んで分ける。',
    '- 「何が新しいのか」「なぜ重要か」を軸にする。記事に書かれていないことは足さない。',
    '- 冒頭で全体を予告し、最後に一言でまとめる。',
    '- 読み上げられるので、記号や箇条書き、URL、英略語の羅列は避けて話し言葉にする。',
    extra ? `\n## 追加の指示\n${extra}` : '',
    '',
    `# 素材（${source.articles.length}件）`,
    `全体の主題: ${source.title}`,
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateScript(
  source: ScriptSource,
  extra = '',
): Promise<ScriptResult> {
  const { data, usage } = await generateJson<{ slides: Slide[]; lines: ScriptLine[] }>({
    model: SCRIPT_MODEL,
    prompt: buildPrompt(source, extra),
    schema: SCHEMA,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    thinkingBudget: THINKING_BUDGET,
  });

  const slides = normalizeSlides(data.slides ?? []);

  // スライドが1枚も取れなくても、表紙を1枚こしらえて先に進む。
  // 欲しいのは音声のほうで、スライドはその添え物。ここで諦めると
  // 生成に使ったぶんが丸ごと無駄になる。
  const usable = slides.length > 0 ? slides : [{ type: 'title' as const, title: source.title }];
  const lines = normalizeLines(data.lines ?? [], usable.length);

  if (lines.length === 0) {
    // 何を受け取って何が残らなかったのかが分からないと直しようがない。
    throw new Error(
      `台本が空です（受信: スライド${(data.slides ?? []).length}件・発話${(data.lines ?? []).length}件）`,
    );
  }

  return { lines, slides: usable, usage };
}

/**
 * 型ごとに要る項目が欠けている行が来ることがあるので、ここで形を整える。
 * 枚数の上限もここで切る（スキーマ側の maxItems が使えないため）。
 */
function normalizeSlides(raw: Slide[]): Slide[] {
  const out: Slide[] = [];

  for (const raws of raw) {
    // 型ごとに使う項目が決まっているのに、モデルは heading と title を
    // 入れ替えて返してくることがある。名前で厳密に見ずに、
    // 「その型として出せるだけの中身があるか」で拾う。
    const s = raws as Partial<Record<'type' | 'title' | 'subtitle' | 'heading' | 'text' | 'cite', string>> & {
      bullets?: string[];
    };
    const bullets = (s.bullets ?? []).map((b) => String(b).trim()).filter(Boolean).slice(0, 5);
    const heading = (s.heading || s.title || '').trim();

    if (s.type === 'bullets' && (bullets.length > 0 || heading)) {
      out.push({ type: 'bullets', heading, bullets });
    } else if (s.type === 'quote' && s.text) {
      out.push({ type: 'quote', text: s.text, cite: s.cite || undefined });
    } else if (heading) {
      // type が欠けている・知らない値でも、見出しがあるなら表紙として出せる。
      out.push({ type: 'title', title: heading, subtitle: s.subtitle || undefined });
    }

    if (out.length >= MAX_SLIDES) break;
  }

  return out;
}

/**
 * 発話の整形。
 *
 * slide が範囲外だったり戻ったりすると、再生側でスライドが飛ぶ・巻き戻る。
 * ここで「前の値以上」「範囲内」に丸めておけば、再生側は素直に前から出すだけで済む。
 */
function normalizeLines(raw: ScriptLine[], slideCount: number): ScriptLine[] {
  const out: ScriptLine[] = [];
  let current = 0;

  for (const line of raw) {
    const text = String(line.text ?? '').trim();
    if (!text) continue;

    const wanted = Number.isFinite(line.slide) ? Math.trunc(line.slide) : current;
    current = Math.min(Math.max(wanted, current), Math.max(slideCount - 1, 0));

    out.push({
      speaker: line.speaker === 'B' ? 'B' : 'A',
      text,
      slide: current,
    });

    if (out.length >= MAX_LINES) break;
  }

  return out;
}
