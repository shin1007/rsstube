-- 声をユーザーが選べるようにする（2026-08-27）。
--
-- それまで声は `GEMINI_TTS_VOICE_A` / `_B` の環境変数だった。**環境変数は
-- オーナーしか触れない。**手元と本番で別々に入れ直す必要もあり、
-- 「気に入ったものを選ぶ」という好みの話を、デプロイの話にしてしまっていた。
-- 好みはユーザーごとに違うので、設定に持たせる。
--
-- media 側にも焼くのは voice_mode(0022) と同じ理由。1本の音声はセグメントごとに
-- 何度も合成するので、途中で設定を変えると**同じ音声の前半と後半で声が変わる**。
-- 作り始めた時点の声を media に写して、そこだけを見る。
--
-- 既定は Kore / Puck（それまでの環境変数の既定と同じ）。声の名前は Gemini TTS の
-- prebuilt voice 名で、`samples/voices/` に6種類の聴き比べがある。

alter table settings
  add column if not exists tts_voice_a text not null default 'Kore',
  add column if not exists tts_voice_b text not null default 'Puck';

comment on column settings.tts_voice_a is
  '1人語りの声、対話では進行役。Gemini TTS の prebuilt voice 名。';
comment on column settings.tts_voice_b is
  '対話の聞き手の声。1人語りでは使わない。';

alter table media
  add column if not exists voice_a text,
  add column if not exists voice_b text;

comment on column media.voice_a is
  'この音声を作り始めたときの声。null は環境変数の既定で作られた古い行。';
comment on column media.voice_b is
  '同上（対話の聞き手）。';
