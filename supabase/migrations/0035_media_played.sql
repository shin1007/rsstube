-- 「聴く」に未視聴のバッジを出すための印。
--
-- これまで media には「聴いたかどうか」がどこにも無かった。一覧は新しい順に
-- 並ぶだけなので、朝のダイジェストが出来ていても**開くまで分からない**し、
-- 開いても既に聴いたものとの区別が付かない（記事側には article_states があるのに、
-- 音声側には無かった）。
--
-- media は user_id を持つ（0010）ので、記事のように別テーブルへ切り出す必要は無い。
-- 列を1つ足すだけで済む。
alter table media add column if not exists played_at timestamptz;

comment on column media.played_at is
  '最初に再生した時刻。null なら未視聴。サイドバー・下部タブのバッジで数える。';

-- バッジは全ページの描画で数えるので、部分索引で引く。
create index if not exists media_unplayed_idx
  on media (user_id)
  where status = 'ready' and played_at is null;
