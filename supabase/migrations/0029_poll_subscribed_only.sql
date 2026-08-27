-- 誰も購読していないフィードを巡回しない。
--
-- 巡回は `feeds` を直に見ていた。feeds は全ユーザー共通で（0005）、購読の有無を
-- 持っていないので、**購読をやめたフィードも毎時取りに行き続ける**。
--
-- 気づいたのは18本のテスト用フィードをまとめて外したとき。解除しただけでは
-- 何も止まらず、記事は入り続け、本文抽出と要約（Gemini の無料枠）も
-- そのまま走り続ける。しかも画面には出ないので、**誰も読まない記事のために
-- 枠を使っていることが表からは分からない**。
--
-- 掃除（purge_orphan_feeds）任せにもできない。あれはスターや書き出し済みの
-- 記事が1件でも残っているフィードを消さない（消すと記事ごと巻き添えになるため）。
-- つまり「印を付けた記事があるフィード」は解除後も永久に残り、永久に巡回される。
-- 実際、外した18本のうち11本がこれに当たった。
--
-- 消すかどうかと、取りに行くかどうかは別の判断。ここは後者だけを決める。

create or replace function feeds_to_poll(job_limit int default 40)
returns setof feeds
language sql
stable
set search_path = public
as $$
  select f.*
    from feeds f
   where exists (select 1 from subscriptions s where s.feed_id = f.id)
   -- 最後に取得してから古い順。呼び出し側が連続失敗ぶんの間隔を見る。
   order by f.last_fetched_at asc nulls first
   limit job_limit
$$;

comment on function feeds_to_poll is
  '巡回の対象。誰も購読していないフィードは返さない。feeds は購読の有無を持たないため。';
