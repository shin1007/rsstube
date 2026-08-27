-- 既定値の変更（2026-08-27、オーナーの判断）。
--
--   1. 音声の話し方は「1人の語り」を既定にする。声は各ユーザーが選ぶものにする。
--   2. 音声の保持は30日 → 14日。まだ毎日は使っていないので、短いほうから始める。
--
-- **列の default を変えても、既に在る行は変わらない。** settings の行は
-- 設定画面を一度でも保存すると作られ、そのときの default が焼き付く。
-- なので「まだ古い既定のままの行」だけ、新しい既定へ寄せる。
-- 自分で選んだ値（dialogue をあえて選んだ、日数を自分で入れた）は動かさない
-- ——と、値だけでは区別が付かないのが正直なところだが、いま在る行は
-- オーナーの1行だけで、そのオーナーからの指示でこれを流す。
--
-- TS 側の既定は src/lib/settings/defaults.ts にある。**両方を揃えること。**
-- 行が無いユーザーには列の default が効かず、TS 側の定数だけが出る。

alter table settings
  alter column voice_mode set default 'solo';

comment on column settings.voice_mode is
  '音声の作り。dialogue = 2人の対話、solo = 1人の語り（既定）。次に作るものから効く。';

update settings set voice_mode = 'solo' where voice_mode = 'dialogue';

alter table settings
  alter column media_retention_days set default 14;

comment on column settings.media_retention_days is
  'サーバー上の音声を置いておく日数。0 で無期限。既定14日。';

update settings set media_retention_days = 14 where media_retention_days = 30;
