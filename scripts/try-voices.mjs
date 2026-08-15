import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Gemini TTS の声を聴き比べる。
 *
 * 1人語りを選べるようにしたので、どの声で読ませるかを決める必要がある。
 * 文字で説明しても分からないので、同じ文を各声で読ませて `samples/voices/` に出す。
 *
 * 気に入ったものが決まったら `.env.local` の `GEMINI_TTS_VOICE_A`（1人語りと
 * 対話の進行役）と `GEMINI_TTS_VOICE_B`（対話の聞き手）に入れる。
 * 本番の Vercel にも同じ値を入れること。
 *
 * **1声＝TTS 1回**なので無料枠を食う。既定の6声で6回。
 *
 *   node --env-file=.env.local scripts/try-voices.mjs
 *   node --env-file=.env.local scripts/try-voices.mjs Kore Puck   # 声を指定
 */

const OUT = 'samples/voices';
const MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';
const SAMPLE_RATE = 24_000;

/**
 * 既定で試す声。
 *
 * Gemini のプリセットは30種類ほどあるが、全部試すと無料枠を使い切る。
 * 落ち着いた読み・明るい読み・低い声が混ざるように選んである。
 */
const DEFAULT_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Leda', 'Orus'];

/** ニュースの読み上げらしい文。抑揚と固有名詞の読みが分かるものにしてある。 */
const TEXT =
  'おはようございます。今朝のダイジェストです。' +
  'グーグルが準同型暗号を使った推論の仕組みを公開しました。' +
  '暗号化したままのデータで計算できるため、内容を見せずに結果だけを受け取れます。' +
  '日銀は三か月ぶりとなる利上げの是非を議論する見通しです。';

const voices = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_VOICES;
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY がありません');

mkdirSync(OUT, { recursive: true });

/**
 * 生PCM に WAV のヘッダを付ける。
 *
 * MP3 にするには lamejs（TS 側の pcmToMp3）が要るが、この台本は
 * 聴き比べるだけなので、どこでも鳴る WAV で十分。依存を増やさない。
 */
function toWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt チャンクの長さ
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // モノラル
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // バイト毎秒
  header.writeUInt16LE(2, 32); // ブロック境界
  header.writeUInt16LE(16, 34); // ビット深度
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * 1分あたりの上限に当たるので間隔を空ける。
 *
 * 6声を続けて叩いたら4声目までは通り、残り2つが 429 になった。
 * 直後に単発で叩くと 200 が返るので、1日ぶんが尽きたのではなく毎分の制限。
 */
const WAIT_MS = 20_000;

for (const [i, voice] of voices.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, WAIT_MS));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `次の文章を、自然な間合いで読み上げてください。\n\n${TEXT}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    },
  );

  if (!res.ok) {
    console.log(`${voice.padEnd(10)} x ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }

  const json = await res.json();
  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) {
    console.log(`${voice.padEnd(10)} x 音声が返らなかった`);
    continue;
  }

  const pcm = Buffer.from(b64, 'base64');
  const wav = toWav(pcm);
  writeFileSync(`${OUT}/${voice}.wav`, wav);
  const sec = pcm.length / (SAMPLE_RATE * 2);
  console.log(`${voice.padEnd(10)} ${sec.toFixed(1)}秒  ${(wav.length / 1024).toFixed(0)}KB`);
}

console.log(`\n${OUT}/ に出しました。気に入った声を .env.local の GEMINI_TTS_VOICE_A / _B に。`);
