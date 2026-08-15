-- 音声を「2人の対話」にするか「1人の語り」にするか選べるようにする。
--
-- 対話は NotebookLM の音声概要と同じ形で、専門外の話題でも耳で追いやすい。
-- ただし相槌と質問のぶんだけ長くなるし、好みも分かれる。
-- 情報を早く取りたいときは1人で淡々と読んだほうがよい。
--
-- media 側にも持たせるのは、あとから設定を変えても**作った音声の素性が
-- 変わらない**ようにするため。台本は生成時のモードに縛られているので、
-- 設定を見に行くと「対話の台本を1人の声で読む」ような食い違いが起きる。

alter table settings
  add column if not exists voice_mode text not null default 'dialogue'
    check (voice_mode in ('dialogue', 'solo'));

comment on column settings.voice_mode is
  '音声の作り。dialogue = 2人の対話、solo = 1人の語り。次に作るものから効く。';

alter table media
  add column if not exists voice_mode text not null default 'dialogue'
    check (voice_mode in ('dialogue', 'solo'));

comment on column media.voice_mode is
  'この音声を作ったときのモード。設定を変えても過去のものは作られた形のまま。';
