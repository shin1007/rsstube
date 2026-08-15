-- RSS が配ってきた本文を、抽出結果とは別の列に取っておく。
--
-- これまで poll は RSS の本文を content_text に入れ、あとから抽出結果が
-- **同じ列を上書き**していた。1回目は問題ない。困るのは取り直すときで、
-- 「抽出に失敗したら RSS に戻す」つもりのフォールバックが、実際には
-- 前回の抽出結果（＝掴んでしまったメニュー）を読み直すことになる。
--
-- 実際、東洋経済は記事ページがグローバルメニューしか返さず、それが
-- content_text に1244字ぶん残っていた。取り直しても同じものが再生産される。
--
-- 元を別に持てば、何度取り直しても RSS へ正しく戻れる。
--
-- 容量は増えるが、保持ポリシー（purge_article_bodies）で本文と一緒に落とす。

alter table articles
  add column if not exists rss_html text;

comment on column articles.rss_html is
  'RSS が配ってきた本文（HTML）。抽出結果で上書きしないこと。取り直すときの戻り先。';

-- 保持ポリシーに rss_html を足す。中身は 0019 と同じで、落とす列だけ増やしている。
create or replace function purge_article_bodies()
returns int
language plpgsql
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
            or s.read_later
            or s.exported_at is not null
            or coalesce((select t.retention_days from settings t where t.user_id = s.user_id), 90) = 0
            or a.created_at >= now() - make_interval(days => coalesce(
                 (select t.retention_days from settings t where t.user_id = s.user_id), 90))
          )
     );

  get diagnostics purged = row_count;
  return purged;
end $$;

comment on function purge_article_bodies() is
  '購読者全員が読み終えて保持期間を過ぎた記事の本文（テキスト・HTML・RSS原文）を落とす。pg_cron から毎日呼ぶ。';
