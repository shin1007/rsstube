-- 購読解除で「意図して残したもの」まで消えないようにする。
--
-- これまでの unsubscribe_feed は、そのフィードの article_states を全部消していた。
-- 未読を消したいのは分かるが、スター・あとで読む・NotebookLM へ書き出し済みの印は
-- 「意図して残しているもの」で、購読をやめた瞬間に消えてよいものではない。
-- しかも取り消しが効かない（purge_orphan_feeds が翌日には記事ごと消すので、
-- 購読し直しても戻らない）。
--
-- 保持ポリシー（purge_article_bodies）は既に
-- 「スター・あとで・書き出し済みは意図して残しているものなので触らない」
-- という判断をしている。購読解除もそれに揃える。
--
-- 結果として、購読をやめると:
--   消える  未読と、ただ読んだだけの記事の状態  → 一覧から出なくなる
--   残る    スター / あとで / 書き出し済み       → スター・あとで・アーカイブから引ける

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
     and s.user_id = auth.uid()
     -- 印を付けたものは残す。
     and not s.is_starred
     and not s.read_later
     and s.exported_at is null;

  delete from subscriptions
   where user_id = auth.uid() and feed_id = in_feed_id;
end $$;

comment on function unsubscribe_feed is
  '購読を解除する。スター・あとで・書き出し済みの記事は残す（意図して取ってあるものなので）。';

-- 孤児フィードの掃除も揃える。
--
-- 誰も購読していなくても、誰かがスターを付けた記事が残っていればフィードは消せない
-- （feeds を消すと articles が cascade で消え、スターごと巻き添えになる）。
create or replace function purge_orphan_feeds()
returns int
language plpgsql
as $$
declare
  purged int;
begin
  delete from feeds f
   where not exists (select 1 from subscriptions s where s.feed_id = f.id)
     -- まだ誰かの状態行から参照されている記事があるなら残す。
     and not exists (
       select 1
         from articles a
         join article_states st on st.article_id = a.id
        where a.feed_id = f.id
     );

  get diagnostics purged = row_count;
  return purged;
end $$;

comment on function purge_orphan_feeds() is
  '誰にも購読されず、状態行も残っていないフィードを消す。スター等が残っていれば消さない。';
