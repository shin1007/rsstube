-- 記事本文の保持ポリシー。
--
-- articles.content_text は本文全文を持つので、DBサイズのほぼ全部がこれになる。
-- フィード50本を1時間毎に巡回すると月に数千記事入るため、放っておくと
-- Supabase 無料枠の 500MB を静かに削っていく。
--
-- 行そのものは消さない。articles を消すと url_hash も消え、まだフィードに
-- 残っている記事が次の巡回で「新着の未読」として戻ってくる。
-- 消すのは本文だけにして、重複判定に必要な最小限（url_hash・タイトル・日付）は残す。
-- これで FTS の gin 索引（title + content_text）も一緒に縮む。

alter table settings
  add column if not exists retention_days int not null default 90;

comment on column settings.retention_days is
  '既読記事の本文を保持する日数。0で無効（永久に保持）。';

-- 対象は「読み終わって、取っておく理由が無い」記事だけ:
--   既読 / スター無し / あとで読む無し / NotebookLM へ未書き出し
-- スター・あとで・書き出し済みは意図して残しているものなので触らない。
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
    from article_states s
   where s.article_id = a.id
     and a.content_text is not null
     and s.is_read
     and not s.is_starred
     and not s.read_later
     and s.exported_at is null
     -- settings 行がまだ無いユーザーは既定の90日。0 を入れている間は一切消さない。
     and coalesce((select t.retention_days from settings t where t.user_id = a.user_id), 90) > 0
     and a.created_at < now() - make_interval(days => coalesce(
           (select t.retention_days from settings t where t.user_id = a.user_id), 90));

  get diagnostics purged = row_count;
  return purged;
end $$;

comment on function purge_article_bodies() is
  '保持期間を過ぎた既読記事の本文を落とす。pg_cron から毎日呼ぶ（supabase/scheduler.sql）。';
