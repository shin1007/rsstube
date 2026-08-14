-- フィードの健康状態を見えるようにする。
--
-- 死に方は2通りある:
--
--   1. 取得に失敗する（404・DNS切れ・タイムアウト）
--      error_count と last_error で追えているが、サイドバーに小さく「!」が出るだけで、
--      12時間に1回の再試行を延々と続ける。気づく手がかりが弱い。
--
--   2. 取得はできるが新しい記事が来ない
--      いまは**まったく見えない**。サイトが更新をやめてもフィード自体は 200 を返すので、
--      失敗回数は 0 のまま。実データでも MDN Blog が60日新着なしだった。
--
-- 2 を見えるようにするために、最新記事の時刻をフィード側に持つ。
-- articles を毎回集計しても出せるが、一覧を出すたびに全フィードぶんの
-- max() が要る形になるので、取り込み時に更新する列にしておく。

alter table feeds
  add column if not exists last_article_at timestamptz;

comment on column feeds.last_article_at is
  '最後に新しい記事が入った時刻。取得できているのに更新が止まったフィードを見つけるため。';

-- 既存ぶんを埋める。published_at が無い記事は取り込んだ時刻で代用する。
update feeds f
   set last_article_at = sub.newest
  from (
    select feed_id, max(coalesce(published_at, created_at)) as newest
      from articles
     group by feed_id
  ) sub
 where sub.feed_id = f.id
   and f.last_article_at is null;

-- 一覧では「古い順」に見たいので索引を張っておく。null（記事0件）を先頭に。
create index if not exists feeds_last_article_idx
  on feeds (last_article_at nulls first);
