-- 購読と解除。
--
-- feeds は全ユーザー共通になったので（0005）、書き込みポリシーを作っていない。
-- タイトルや etag は巡回が持ち主で、購読者に書き換えられると他の購読者に響く。
-- だが購読するには「まだ誰も購読していないフィードの行を作る」必要がある。
--
-- そこで、その一手だけを通す関数を security definer で置く。
-- 購読者ができるのは「URL を渡してフィード行を用意し、自分の購読を作る」ことだけで、
-- 既にある行のタイトルや取得状態には触れない。

create or replace function subscribe_feed(
  feed_url   text,
  feed_title text default '',
  feed_site  text default null,
  in_folder  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
begin
  if auth.uid() is null then
    raise exception '未ログインです';
  end if;

  -- 既にあればその行を使う。無ければ作る。タイトルは初回だけ効く。
  insert into feeds (url, title, site_url)
       values (feed_url, coalesce(feed_title, ''), feed_site)
  on conflict (url) do nothing;

  select id into fid from feeds where url = feed_url;
  if fid is null then
    raise exception 'フィードを作れませんでした: %', feed_url;
  end if;

  insert into subscriptions (user_id, feed_id, folder_id)
       values (auth.uid(), fid, in_folder)
  on conflict (user_id, feed_id) do update set folder_id = excluded.folder_id;

  -- 購読した時点で、そのフィードの既存記事を未読として自分の一覧に出す。
  -- これが無いと、次の巡回で新着が来るまで購読が空に見える。
  insert into article_states (article_id, user_id)
  select a.id, auth.uid() from articles a where a.feed_id = fid
  on conflict (article_id, user_id) do nothing;

  return fid;
end $$;

comment on function subscribe_feed is
  'フィード行を用意して購読する。feeds に直接 insert させないための唯一の入口。';

-- 解除。購読と、その人ぶんの既読状態を落とす。記事とフィード自体は他の購読者の
-- ものでもあるので消さない。
create or replace function unsubscribe_feed(in_feed_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '未ログインです';
  end if;

  delete from article_states s
   using articles a
   where s.article_id = a.id
     and a.feed_id = in_feed_id
     and s.user_id = auth.uid();

  delete from subscriptions
   where user_id = auth.uid() and feed_id = in_feed_id;
end $$;

comment on function unsubscribe_feed is
  '購読を解除する。記事とフィードは他の購読者のものでもあるので残す。';

-- 誰にも購読されなくなったフィードと、その記事を片付ける。
-- pg_cron の毎日の掃除から呼ぶ（supabase/scheduler.sql）。
create or replace function purge_orphan_feeds()
returns int
language plpgsql
as $$
declare
  purged int;
begin
  delete from feeds f
   where not exists (select 1 from subscriptions s where s.feed_id = f.id);
  get diagnostics purged = row_count;
  return purged;
end $$;

comment on function purge_orphan_feeds() is
  '購読者がいなくなったフィードを消す。記事は on delete cascade で一緒に消える。';
