-- 記事・要約・フィードを全ユーザー共通にする。
--
-- これまでは articles が (user_id, url_hash) 一意で、同じ記事を購読者ごとに
-- 複製していた。実測で記事178件＝3.7MB（本文平均8KB）、要約は BATCH_SIZE=5 で
-- 178件あたり約36回の Gemini 呼び出し。どちらも購読者数に比例して増えるので、
-- この形のままでは Supabase の 500MB にも Gemini の無料枠にも収まらない。
--
-- 記事の中身は公開された RSS の内容であって秘密ではない。共通化して困るのは
-- 「誰が何を購読しているか」「どれを読んだか」のほうなので、そちらだけ
-- ユーザーごとに残す:
--
--   共通  feeds / articles / summaries
--   個人  subscriptions / article_states / folders / exports / digests / settings
--
-- これで購読者が増えても増えるのは article_states の行だけになる。

-- 共通化するテーブルの user_id を落とす前に、それを参照している RLS ポリシーを
-- 外しておく。残したままだと drop column が依存関係で弾かれる。
drop policy feeds_owner     on feeds;
drop policy articles_owner  on articles;
drop policy summaries_owner on summaries;
drop policy jobs_owner      on jobs;

-- ---------------------------------------------------------------- feeds
-- フィード自体は URL で一意。folder は購読ごとの持ち物なので subscriptions へ移す。

create table subscriptions (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feed_id    uuid not null references feeds (id) on delete cascade,
  folder_id  uuid references folders (id) on delete set null,
  -- 購読者が付け直した表示名。null ならフィード側の title を使う。
  title      text,
  created_at timestamptz not null default now(),
  primary key (user_id, feed_id)
);

-- 既存の feeds 行から購読を起こす。この時点では feeds はまだ1ユーザーぶんしか
-- 無いので、URL の重複は起きない。
insert into subscriptions (user_id, feed_id, folder_id, created_at)
select user_id, id, folder_id, created_at from feeds;

alter table feeds drop constraint feeds_user_id_url_key;
alter table feeds drop column user_id;
alter table feeds drop column folder_id;
alter table feeds add constraint feeds_url_key unique (url);

-- ---------------------------------------------------------------- articles
alter table articles drop constraint articles_user_id_url_hash_key;
alter table articles drop column user_id;
alter table articles add constraint articles_url_hash_key unique (url_hash);

-- ---------------------------------------------------------------- summaries
-- article_id が主キーなので、user_id を落とすだけで共通になる。
alter table summaries drop column user_id;

-- ---------------------------------------------------------------- article_states
-- 記事が共通になったので、既読・スターは「記事1件につき1行」では足りない。
-- 主キーを (article_id, user_id) にして購読者ごとに持てるようにする。
alter table article_states drop constraint article_states_pkey;
alter table article_states add primary key (article_id, user_id);
create index article_states_user_unread_idx on article_states (user_id) where not is_read;

-- ---------------------------------------------------------------- jobs
-- extract と summarize は「記事1件ぶんの仕事」であって誰のものでもない。
-- digest / script / tts はユーザーごとに出すものなので user_id を残す。
alter table jobs alter column user_id drop not null;
alter table jobs alter column user_id drop default;
update jobs set user_id = null where type in ('extract', 'summarize');

-- ---------------------------------------------------------------- RLS
-- 共通テーブルはログイン済みなら誰でも読める。書き込むのは Secret キーを使う
-- cron / ワーカーだけで、そちらは RLS を迂回するので書き込みポリシーは作らない。
create policy feeds_read     on feeds     for select to authenticated using (true);
create policy articles_read  on articles  for select to authenticated using (true);
create policy summaries_read on summaries for select to authenticated using (true);
-- jobs はユーザーに見せない。ポリシーを作らなければ Secret キー以外からは空になる。

alter table subscriptions enable row level security;
create policy subscriptions_owner on subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- 索引
-- user_id を落とすと、それを先頭に持つ索引も一緒に消える。
-- articles_user_published_idx と summaries_importance_idx がそれにあたるので、
-- ユーザーを外した形で貼り直す。(feed_id, published_at) の索引は元からある。
create index articles_published_idx on articles (published_at desc nulls last);
create index summaries_importance_idx on summaries (importance desc);
create index subscriptions_feed_idx on subscriptions (feed_id);

-- ---------------------------------------------------------------- 保持ポリシー
-- 本文が共通になったので、1人が既読にしただけでは消せない。購読者の誰かが
-- スター・あとで読む・書き出し済みにしていれば残す。「誰も読んでいない記事」も
-- 消さない（まだ誰かの未読一覧に出るため）。
create or replace function purge_article_bodies()
returns int
language plpgsql
as $$
declare
  purged int;
begin
  update articles a
     set content_text = null,
         content_ok   = false
   where a.content_text is not null
     -- 状態行が1つ以上あり、そのすべてが「読み終わって取っておく理由が無い」
     and exists (select 1 from article_states s where s.article_id = a.id)
     and not exists (
       select 1 from article_states s
        where s.article_id = a.id
          and (
            not s.is_read
            or s.is_starred
            or s.read_later
            or s.exported_at is not null
            -- その購読者の保持期間がまだ過ぎていない。0 は「消さない」。
            or coalesce((select t.retention_days from settings t where t.user_id = s.user_id), 90) = 0
            or a.created_at >= now() - make_interval(days => coalesce(
                 (select t.retention_days from settings t where t.user_id = s.user_id), 90))
          )
     );

  get diagnostics purged = row_count;
  return purged;
end $$;

comment on function purge_article_bodies() is
  '購読者全員が読み終えて保持期間を過ぎた記事の本文を落とす。pg_cron から毎日呼ぶ。';
