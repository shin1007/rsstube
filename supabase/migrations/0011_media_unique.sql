-- media の重複防止を効くようにする。
--
-- 0010 で unique (user_id, kind, article_id, digest_id) を張ったが、これは効かない。
-- Postgres は UNIQUE の中の NULL を「互いに異なる値」として扱うので、
-- ダイジェストの行（article_id が NULL）どうしは何行でも作れてしまう。
-- 実際に同じ digest_id で2行入ることを確認した。
--
-- 二重に入ると、同じ内容の音声化が2本走って無料枠を二重に食う。
-- requestMedia() は先に存在を見てから作るが、二度押しのような同時実行では
-- すり抜ける。最後の砦はDB側に置く。
--
-- 直し方は2つ（NULLS NOT DISTINCT / 部分索引）。ここでは部分索引にする。
-- kind ごとに「実際に使う列」だけで一意にでき、意図がそのまま読めるため。

alter table media drop constraint if exists media_user_id_kind_article_id_digest_id_key;

create unique index if not exists media_article_unique
  on media (user_id, article_id) where kind = 'article';

create unique index if not exists media_digest_unique
  on media (user_id, digest_id) where kind = 'digest';

comment on index media_article_unique is
  '同じ記事を二重に音声化しない。NULL 混じりの UNIQUE は効かないので部分索引で担保する。';
