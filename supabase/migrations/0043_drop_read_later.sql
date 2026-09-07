-- 「あとで読む」をやめる（2026-09-07 決定。**蒸し返さない**）。
--
-- 印が2つある必要が無かった。スターと「あとで」はどちらも「これは後で
-- 何かする」の意味で、**分け方を説明できない**——実データでも「あとで」は
-- 2件、スターは5件で、どちらに入れるかは付けた日の気分でしかなかった。
-- 一覧の右スワイプ・`l`・下タブ・記事の操作帯・スマホのメニューと、
-- 入口だけは5か所あって、そのぶん指の当たり判定と説明が要っていた。
--
-- **列ごと落とす。** 0037（重要度）と同じ理由で、「残したまま使わない」に
-- しない——画面に出ていれば読む人は意味を探すし、DB に残っていれば次に
-- 触る人が「これは何のためか」を探す。書き出しの `exportReadLater()` も
-- 呼び出し元が無いまま残っていたので、一緒に消してある（コード側）。
--
-- 消えるのは「あとで」に入れた2件の印だけで、記事も既読もスターも残る。

-- 1. 購読をやめたときに「印を付けた記事は残す」判定（0012）。
create or replace function unsubscribe_feed(in_feed_id uuid)
returns void
language plpgsql
security invoker
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
     and s.user_id = auth.uid()
     -- 印を付けたものは残す。
     and not s.is_starred
     and s.exported_at is null;

  delete from subscriptions
   where user_id = auth.uid() and feed_id = in_feed_id;
end
$$;

-- 2. 保持期間を過ぎた本文を落とす掃除（0019 / 0021）。
create or replace function purge_article_bodies()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  purged int;
begin
  update articles a
     set content_text = null,
         content_html = null,
         rss_html     = null,
         content_ok   = false
   where (a.content_text is not null or a.content_html is not null or a.rss_html is not null)
     and exists (select 1 from article_states s where s.article_id = a.id)
     and not exists (
       select 1 from article_states s
        where s.article_id = a.id
          and (
            not s.is_read
            or s.is_starred
            or s.exported_at is not null
            or coalesce((select t.retention_days from settings t where t.user_id = s.user_id), 90) = 0
            or a.created_at >= now() - make_interval(days => coalesce(
                 (select t.retention_days from settings t where t.user_id = s.user_id), 90))
          )
     );

  get diagnostics purged = row_count;
  return purged;
end
$$;

-- 3. 一覧（0042）。ビューから `later` を落とし、行にも運ばない。
create or replace function list_articles(
  p_view       text    default 'unread',
  p_folder     uuid    default null,
  p_feed       uuid    default null,
  p_term       text    default null,
  p_limit      int     default 60,
  p_offset     int     default 0,
  p_with_count boolean default false,
  p_ids_only   boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- **語に当たる id は、先に・別に集めること（`as materialized`）。**
  --
  -- `&@` を下の where に直接書くと、計画は「新しい順に走りながら1行ずつ
  -- `&@` を当てて、60件たまったら止まる」に化ける。索引は使われず、本文を
  -- 1行ずつ読み直すので **215ms**（実測）——0040 で ilike をやめた理由と
  -- 同じ形が、書き方を変えただけで戻ってくる。先に集合にしておけば
  -- PGroonga の索引がそのまま効いて **3〜13ms**。
  --
  -- 語が無いときは `coalesce(p_term,'') <> ''` が定数の偽になり、計画には
  -- One-Time Filter だけが残る（この CTE は走らない）。
  with matched as materialized (
    select a.id
      from articles a
     where coalesce(p_term, '') <> ''
       and (a.title &@ p_term or a.title_ja &@ p_term or a.content_text &@ p_term)
  ),
  picked as (
    select a.id,
           a.published_at,
           -- 窓は LIMIT/OFFSET より先に計算されるので、これが絞り込み後の総数。
           case when p_with_count then count(*) over () else null end as total
      from articles a
      join article_states st on st.article_id = a.id
      left join summaries sm on sm.article_id = a.id
     where a.feed_id in (
             select s.feed_id
               from subscriptions s
              where p_folder is null or s.folder_id = p_folder
           )
       and (p_feed is null or a.feed_id = p_feed)
       and (coalesce(p_term, '') = '' or a.id in (select m.id from matched m))
       and case coalesce(p_view, 'all')
             when 'unread'  then st.is_read = false
             when 'starred' then st.is_starred = true
             -- 要約が落ちたものを見つけるビュー。**まだ本文を取りに行っていない
             -- 記事は混ぜない**（要約が無くて当たり前で、待てば付く。0014）。
             when 'unsummarized' then sm.article_id is null and a.extracted_at is not null
             else true
           end
     -- **同着は id で決める。** 実データで243件が同じ日時を持っていて
     -- （45組・最大18件が同時刻）、決めないと継ぎ足しで重複・欠落する。
     order by a.published_at desc nulls last, a.id desc
     limit greatest(coalesce(p_limit, 0), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    -- **1件も無いときは 0。null にしないこと**——null は「数えていない」
    -- （継ぎ足しのとき）という別の意味を持っていて、「ここで終わり」と同じではない。
    'total', case when p_with_count
                  then coalesce((select max(total) from picked), 0)
                  else null end,
    'articles',
      case when p_ids_only then
        coalesce((
          select jsonb_agg(
                   jsonb_build_object('id', p.id, 'published_at', iso8601(p.published_at))
                   order by p.published_at desc nulls last, p.id desc
                 )
            from picked p
        ), '[]'::jsonb)
      else
        coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id', a.id,
                     'title', a.title,
                     -- 行には出さないが `v`（元記事を開く）が使う。**消さないこと。**
                     'url', a.url,
                     'published_at', iso8601(a.published_at),
                     -- **要点があるときは抜粋を運ばない。** 行に出るのは片方だけで、
                     -- 抜粋は1行あたりでいちばん重い列（日本語で150字ほど）。
                     'excerpt', case
                                  when jsonb_array_length(coalesce(sm.bullets, '[]'::jsonb)) > 0
                                  then null else a.excerpt
                                end,
                     'extracted_at', iso8601(a.extracted_at),
                     'created_at', iso8601(a.created_at),
                     'feed', case when f.id is null then null
                                  else jsonb_build_object('id', f.id, 'title', f.title) end,
                     'summary', case when sm.article_id is null then null
                                     else jsonb_build_object(
                                       -- 行に出るのは先頭3つだけ。4つ目から先は運ぶだけ無駄。
                                       'bullets',
                                       jsonb_path_query_array(coalesce(sm.bullets, '[]'::jsonb),
                                                              '$[0 to 2]'),
                                       'title_ja', sm.title_ja
                                     ) end,
                     'state', jsonb_build_object(
                       'is_read', st.is_read,
                       'is_starred', st.is_starred,
                       'exported_at', iso8601(st.exported_at)
                     )
                   )
                   order by a.published_at desc nulls last, a.id desc
                 )
            from picked p
            join articles a       on a.id = p.id
            join article_states st on st.article_id = p.id
            join feeds f          on f.id = a.feed_id
            left join summaries sm on sm.article_id = p.id
        ), '[]'::jsonb)
      end
  )
$$;

-- 4. 索引と列を落とす。**ここが最後**——上の3つが列を見なくなってから。
drop index if exists article_states_later_idx;
alter table article_states drop column if exists read_later;
