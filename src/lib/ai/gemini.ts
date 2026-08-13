import { GoogleGenAI } from '@google/genai';

/**
 * Gemini クライアントの薄いラッパ。
 *
 * 無料枠で回す前提なので、レート制限(429)とサーバ側の一時エラー(5xx)を
 * ここで見分けられるようにしておく。恒久的な失敗はすぐ諦め、
 * 一時的な失敗はジョブキューに戻して後で再試行させる。
 */

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/** 後で再試行する価値がある失敗（レート制限・一時的なサーバエラー）。 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

function classify(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b(429|500|502|503|504)\b/.test(message) || /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message)) {
    throw new RetryableError(message);
  }
  throw err instanceof Error ? err : new Error(message);
}

/** 1回の呼び出しで使ったトークン。無料枠の消費ペースを見るために記録する。 */
export type Usage = { inputTokens: number; outputTokens: number };

/**
 * JSON を返させる生成。responseSchema で形を固定するので、
 * 「説明文が混ざって JSON.parse に失敗する」よくある事故を避けられる。
 *
 * 使用量を一緒に返すのは、記録する場所（ワーカー）に DB のクライアントがあり、
 * ここには無いため。ここで記録しようとすると、この薄いラッパが DB を持つことになる。
 */
export async function generateJson<T>(opts: {
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
}): Promise<{ data: T; usage: Usage }> {
  try {
    const res = await ai().models.generateContent({
      model: opts.model,
      contents: opts.prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: opts.schema,
      },
    });

    const text = res.text;
    if (!text) throw new Error('Gemini が空の応答を返しました');

    return {
      data: JSON.parse(text) as T,
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (err) {
    classify(err);
  }
}

export const SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL ?? 'gemini-3.5-flash-lite';
export const SCRIPT_MODEL = process.env.GEMINI_SCRIPT_MODEL ?? 'gemini-3.5-flash';
