import lamejs from '@breezystack/lamejs';
import { GoogleGenAI } from '@google/genai';
import { RetryableError, type Usage } from './gemini';
import { SPEAKERS, type ScriptLine, type VoiceMode } from './script';

/**
 * マルチスピーカーTTS と、その出力を MP3 にするところ。
 *
 * 合成の単位はスライド1枚ぶん。1発話ごとに呼ぶと、8分の番組で数十回の
 * リクエストになって無料枠の1日あたり回数を食い潰す。スライド単位なら
 * 1本あたり10回前後で済み、しかもクリップの切れ目がそのまま
 * スライドの切り替わりになる（タイミングの推定が要らなくなる）。
 *
 * Gemini が返すのは生のPCM（audio/l16 24kHz モノラル）で、そのままでは
 * 1秒48KBある。8分で23MBになり Storage の無料枠1GBをすぐ削るので、
 * 64kbps の MP3 にしてから保存する（実測で約6分の1）。
 */

export const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';

/** 返ってくるPCMの形式。ヘッダが無いので、こちらが知っている前提で扱う。 */
const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;

/** MP3 のビットレート。声だけなので 64kbps で十分聞ける。 */
const MP3_KBPS = 64;

/**
 * 話者の声。名前だけ差し替えられるようにしておく
 * （日本語の声は好みが割れるので、実際に鳴らしてから選び直せるように）。
 */
const VOICE_A = process.env.GEMINI_TTS_VOICE_A ?? 'Kore';
const VOICE_B = process.env.GEMINI_TTS_VOICE_B ?? 'Puck';

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export type Synthesized = {
  mp3: Buffer;
  /** 秒。PCM の長さから出すので実測値。 */
  durationSec: number;
  usage: Usage;
};

/** 読み上げさせる台本テキスト。話者名を頭に置くのが multi-speaker の指定方法。 */
export function toSpeechText(lines: ScriptLine[]): string {
  return lines
    .map((l) => `${l.speaker === 'B' ? SPEAKERS.B.name : SPEAKERS.A.name}: ${l.text}`)
    .join('\n');
}

export async function synthesize(
  lines: ScriptLine[],
  mode: VoiceMode = 'dialogue',
): Promise<Synthesized> {
  if (lines.length === 0) throw new Error('読み上げる台本がありません');

  const solo = mode === 'solo';

  const prompt = solo
    ? ['次の文章を、自然な間合いで読み上げてください。', '', lines.map((l) => l.text).join('\n')].join('\n')
    : [
        '次の2人の会話を、自然な間合いで読み上げてください。',
        '話者名は読み上げないこと。',
        '',
        toSpeechText(lines),
      ].join('\n');

  /**
   * 1人のときは multiSpeakerVoiceConfig を使わない。
   *
   * 話者が1人しかいないのに複数話者の設定を渡すと、モデルが台本の中に
   * 話者の切り替わりを探しに行く。名前を前置きしない素の文章を渡すぶん、
   * 単一話者の設定のほうが素直に読む。
   */
  const speechConfig = solo
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_A } } }
    : {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: SPEAKERS.A.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_A } } },
            { speaker: SPEAKERS.B.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_B } } },
          ],
        },
      };

  let res;
  try {
    res = await ai().models.generateContent({
      model: TTS_MODEL,
      contents: prompt,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig,
      },
    });
  } catch (err) {
    // 要約と同じ扱い。429 や 5xx は後で再試行する価値がある。
    const message = err instanceof Error ? err.message : String(err);
    if (/\b(429|500|502|503|504)\b/.test(message) || /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message)) {
      throw new RetryableError(message);
    }
    throw err instanceof Error ? err : new Error(message);
  }

  const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('TTS が音声を返しませんでした');

  const pcm = Buffer.from(data, 'base64');

  return {
    mp3: pcmToMp3(pcm),
    durationSec: pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE),
    usage: {
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * 生PCM(L16 モノラル) を MP3 にする。
 *
 * ffmpeg を使わないのは、Vercel の関数にバイナリを持ち込みたくないため。
 * lamejs は純JSなので、そのままサーバーレスで動く。
 */
export function pcmToMp3(pcm: Buffer): Buffer {
  // Buffer から Int16Array を作るとき、byteOffset を渡さないと
  // プール済みバッファの先頭を読んでしまう（Node の Buffer は共有プール上にある）。
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));

  const encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS);
  const chunks: Buffer[] = [];
  // MP3 の1フレームぶん。この単位で渡すのが lamejs の作法。
  const BLOCK = 1152;

  for (let i = 0; i < samples.length; i += BLOCK) {
    const buf = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (buf.length > 0) chunks.push(Buffer.from(buf));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));

  return Buffer.concat(chunks);
}
