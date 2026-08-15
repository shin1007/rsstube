-- 未読件数を SQL 側で数える。
--
-- これまではアプリが「未読の記事を最大5000行取ってきて JS で数える」形だった。
-- 実測で1171行が返っており、サイドバーに出すのは18個の数字だけなのに、
-- その65倍の行を毎回運んでいたことになる。数える場所を DB に移す。
--
-- 効くのは転送量だけではない。この関数は一覧・設定・書き出し・聴く の
-- **全ページで呼ばれる**（AppShell が持つため）ので、常時かかる費用になる。
--
-- security invoker のままにすること。RLS が効いた状態で数えないと、
-- 他人の未読まで数えてしまう。

create or replace function unread_counts()
returns table (feed_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.feed_id, count(*)
    from articles a
    join article_states s on s.article_id = a.id
   where s.user_id = auth.uid()
     and s.is_read = false
   group by a.feed_id
$$;

comment on function unread_counts() is
  'サイドバー用の未読件数をフィード単位で返す。行を全部運ばずに DB 側で数えるため。';
