import { generateJson, SCRIPT_MODEL, type Usage } from './gemini';
import { DEFAULT_LANGUAGE, languageName } from '@/lib/language';

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
 * 音声の作り。
 *
 * `dialogue` は NotebookLM の音声概要と同じ形で、専門外の話題でも耳で追いやすい。
 * ただし相槌と質問のぶんだけ長くなる。`solo` は1人が淡々と読むので、
 * 同じ中身でも短く済み、内容を早く取りたいときに向く。好みが分かれるので選べるようにした。
 */
export type VoiceMode = 'dialogue' | 'solo';

export const VOICE_MODE_LABELS: Record<VoiceMode, string> = {
  dialogue: '2人の対話（聞き手が質問する形。耳で追いやすい）',
  solo: '1人の語り（淡々と読む。同じ中身でも短い）',
};

/**
 * 出力の上限。
 *
 * JSON は途中で切れると parse できず、生成そのものが丸ごと無駄になる。
 * 指示で長さを頼むだけでは効かなかった（8件のダイジェストで8万字を超える台本を
 * 書いてきて、出力の上限で切れた）ので、渡す素材の量（textLimit）と
 * maxOutputTokens、そして受け取ってからの切り詰めの3段で抑える。
 *
 * **`maxItems` は項目3つまでのオブジェクトなら使える。**7つにすると
 * Gemini が 400 INVALID_ARGUMENT を返す（理由は本文に出ないので原因不明の400に見える）。
 * だからスライドを3項目に平たくして（buildSchema）、上限を効かせている。
 * ここを戻して項目を増やすと、`maxItems` を諦めることになり、
 * 「同じスライドを延々と繰り返して出力を使い切る」壊れ方がまた起きる。
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

/**
 * モデルに返させる形。**画面で使う `Slide` とはわざと別**にしてある。
 *
 * 理由は `maxItems`。項目の多いオブジェクトに付けると Gemini が
 * 400 INVALID_ARGUMENT を返すが、項目3つなら通る（このファイル上部の注記）。
 * 以前のスライドは項目7つ（type/title/subtitle/heading/bullets/text/cite）で
 * 上限を付けられず、**モデルが同じスライドを延々と繰り返して出力を使い切った**
 * ——実測で23302トークン・73639字が全部同じ `bullets` の反復だった。
 * 記事1本から音声を作ると必ずこれで落ちていた。
 *
 * そこで「見出し1つ＋本文の行」という3項目に平たくして、上限を効かせる。
 * 型ごとの違いは受け取ってから組み立て直す（toSlide）。
 */
function buildSchema(maxSlides: number, maxLines: number) {
  return {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        maxItems: maxSlides,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['title', 'bullets', 'quote'] },
            heading: { type: 'string' },
            body: { type: 'array', items: { type: 'string' } },
          },
          required: ['type', 'heading', 'body'],
        },
      },
      lines: {
        type: 'array',
        maxItems: maxLines,
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
}

/** モデルから受け取るスライド。 */
type RawSlide = { type?: string; heading?: string; body?: string[] };

/**
 * 平たい形から画面用の `Slide` に戻す。
 *
 *   title   heading = 主題、body[0] = 副題
 *   bullets heading = 見出し、body = 箇条書き
 *   quote   heading = 出典（省略可）、body[0] = 引用
 */
function toSlide(raw: RawSlide): Slide | null {
  const heading = String(raw.heading ?? '').trim();
  const body = (raw.body ?? []).map((b) => String(b).trim()).filter(Boolean);

  if (raw.type === 'quote' && body.length > 0) {
    return { type: 'quote', text: body[0], cite: heading || undefined };
  }
  if (raw.type === 'title' && heading) {
    return { type: 'title', title: heading, subtitle: body[0] || undefined };
  }
  if (heading && body.length > 0) {
    return { type: 'bullets', heading, bullets: body };
  }
  // 見出しだけ来たときは表紙として拾う。捨てるより出したほうがまし。
  return heading ? { type: 'title', title: heading } : null;
}

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

/**
 * 1本の目安の長さ。長すぎると聴き通せないし、TTS の呼び出しも増える。
 *
 * **素材の量に合わせること。** 8分で固定していたら、記事1本から音声を作るときに
 * モデルが尺を埋めようとして膨らみ、**必ず出力の上限で落ちていた**
 * （実測: 日本語で49605字、英語で22705字。どちらも JSON が途中で切れて丸ごと無駄になる）。
 * ダイジェスト（8件）では起きず、記事1本の「音声にする」だけが壊れていた。
 *
 * 分数だけでなく字数でも言うこと。モデルは「8分程度」より
 * 「3000字以内」のほうがよく従う。
 */
function targetChars(articleCount: number): number {
  if (articleCount <= 1) return 1_200;
  if (articleCount <= 3) return 2_000;
  return 3_000;
}

/**
 * 発話数の上限も素材に合わせる。
 *
 * 字数で頼むだけでは止まらなかった（1件の素材に対して43000字を書き、
 * 出力トークンを使い切った）。**モデルは「何個作るか」のほうがよく守る**ので、
 * 個数で縛る。スライドが2枚しかないのに発話を70個まで許していたのが、
 * 延々と喋り続けられる余地になっていた。
 */
function maxLines(articleCount: number): number {
  if (articleCount <= 1) return 14;
  if (articleCount <= 3) return 30;
  return MAX_LINES;
}

function buildPrompt(
  source: ScriptSource,
  extra: string,
  mode: VoiceMode,
  language: string,
): string {
  const limit = textLimit(source.articles.length);
  const chars = targetChars(source.articles.length);
  const lines = maxLines(source.articles.length);
  const slideCount = Math.min(source.articles.length + 1, MAX_SLIDES);
  const solo = mode === 'solo';

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
    solo
      ? 'あなたはニュース番組の構成作家です。次の記事群から、1人の語りによる'
      : 'あなたはニュース番組の構成作家です。次の記事群から、2人の対話による',
    // 言語は設定に従う。ここを日本語で直書きしていたので、設定を英語にすると
    // 要約は英語・音声は日本語という食い違いが起きていた。
    `音声番組の台本と、それに合わせて表示するスライドを作ってください。` +
      `台本もスライドの文字も、すべて${languageName(language)}で書くこと。`,
    '',
    solo
      ? // 話者は1人でも、出力の形（speaker を持つ配列）は共通にしておく。
        // スキーマを分けると受け取り側も分岐が増える。
        `話者は${SPEAKERS.A.name}（${SPEAKERS.A.role}）ただ1人。` +
        'lines の speaker は全て "A" にすること。"B" を使ってはいけない。' +
        '相槌・質問・呼びかけは入れず、聴き手に語りかける独白にする。'
      : `話者A = ${SPEAKERS.A.name}（${SPEAKERS.A.role}）\n話者B = ${SPEAKERS.B.name}（${SPEAKERS.B.role}）`,
    '',
    '## 分量（守ること）',
    `- スライドは${slideCount}枚ちょうど、発話は${lines}個以内。これを超えてはいけない。`,
    // 字数で言い切る。分数だけだと、素材が少ないときに尺を埋めようとして膨らむ。
    `- **lines の text を合計して${chars}字以内。これを超えてはいけない。**` +
      `（読み上げて約${Math.max(1, Math.round(chars / 350))}分）`,
    source.articles.length <= 1
      ? '- 素材は1件だけ。短くてよい。無理に長くしたり、書かれていないことで尺を埋めたりしないこと。'
      : '- 記事が多いときは1件あたりを短くして収める。全部を深く語ろうとしないこと。',
    '',
    '## スライド',
    `- 枚数は「1（表紙）＋記事の数」。今回は素材が${source.articles.length}件なので` +
      `${slideCount}枚にすること。1枚だけで済ませてはいけない。`,
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
    solo
      ? '- 1発話は40〜120字程度。長い説明は文を切って並べる。相手はいないので問いかけない。'
      : '- 1発話は40〜120字程度。長い説明は相手の相槌や質問を挟んで分ける。',
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
  mode: VoiceMode = 'dialogue',
  /** 出力の言語。設定（settings.summary_language）から渡す。 */
  language: string = DEFAULT_LANGUAGE,
): Promise<ScriptResult> {
  // 上限はプロンプトとスキーマの両方で言う。プロンプトだけだと守られなかった。
  const slideCount = Math.min(source.articles.length + 1, MAX_SLIDES);
  const lineCount = maxLines(source.articles.length);

  const { data, usage } = await generateJson<{ slides: RawSlide[]; lines: ScriptLine[] }>({
    model: SCRIPT_MODEL,
    prompt: buildPrompt(source, extra, mode, language),
    schema: buildSchema(slideCount, lineCount),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    thinkingBudget: THINKING_BUDGET,
  });

  const slides = normalizeSlides(data.slides ?? []);

  // スライドが1枚も取れなくても、表紙を1枚こしらえて先に進む。
  // 欲しいのは音声のほうで、スライドはその添え物。ここで諦めると
  // 生成に使ったぶんが丸ごと無駄になる。
  const usable = slides.length > 0 ? slides : [{ type: 'title' as const, title: source.title }];
  const raw = normalizeLines(data.lines ?? [], usable.length);
  // 1人の語りを頼んでも B が混じることがある。プロンプトの言いつけだけに
  // 頼ると、TTS 側で「いないはずの話者」の声を割り当てる羽目になる。
  const lines = mode === 'solo' ? raw.map((l) => ({ ...l, speaker: 'A' as const })) : raw;

  if (lines.length === 0) {
    // 何を受け取って何が残らなかったのかが分からないと直しようがない。
    throw new Error(
      `台本が空です（受信: スライド${(data.slides ?? []).length}件・発話${(data.lines ?? []).length}件）`,
    );
  }

  return { lines, slides: usable, usage };
}

/**
 * 受け取ったスライドを画面用の形に直し、枚数を切る。
 * 上限はスキーマ側の maxItems でも掛けてあるが、こちらでも念のため守る。
 */
function normalizeSlides(raw: RawSlide[]): Slide[] {
  const out: Slide[] = [];
  for (const r of raw) {
    const slide = toSlide(r);
    if (slide) out.push(slide);
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
