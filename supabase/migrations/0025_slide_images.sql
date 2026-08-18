-- スライドに絵を入れる（文字だけだと「スライドが出ていない」ように見える）。
--
-- スライドは HTML/CSS で描く方針（plan.md §4）なので、絵は素材として別に要る。
-- 記事の og:image を控えておき、音声を作るときに1枚だけ持ってきて表紙にする。
--
-- **URL を直接 <img> に貼らない。** 相手のサイトに毎回取りに行くことになるし、
-- 記事が消えれば画像も消える（音声は30日残るので、先に絵だけ欠ける）。
-- 音声と同じ Storage に写しておけば、こちらの都合だけで完結する。
--
-- 写すのは media 1本につき1枚だけ。全記事ぶんを溜めると Storage の無料枠(1GB)を
-- 音声と奪い合う。ダイジェストは束ねた記事のうち、絵を持っている最初の1件を使う。

alter table articles
  add column if not exists image_url text;

comment on column articles.image_url is
  '記事の代表画像（og:image / twitter:image / RSS の enclosure）。取れなければ null。'
  ' ここには相手のURLをそのまま入れる。表示に使うときは Storage へ写すこと。';

alter table media
  add column if not exists cover_path text;

comment on column media.cover_path is
  'Storage(media バケット)に写した表紙画像のパス。{user_id}/{media_id}/cover.<ext>。'
  ' 記事に絵が無ければ null で、そのときスライドは文字だけで描かれる。';
