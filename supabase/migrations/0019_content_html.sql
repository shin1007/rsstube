-- 記事の見た目を戻す（リンク・画像・動画）。
--
-- これまで本文はプレーンテキストで持ち、pre-wrap で出していた。読めはするが、
-- 画像も図表も動画も落ちるので、写真が主役の記事や図で説明する記事は意味が半減する。
-- リンクも「文字だけ残って飛べない」状態だった。
--
-- 消毒したHTMLを別の列で持つ。テキストを消さないのは、要約に渡すのはテキストの
-- ほうが素直（マークアップはトークンの無駄で、AI に何の情報も足さない）なのと、
-- 検索の対象もテキストで足りるため。
--
-- 容量は増える。本文は DB のほぼ全部を占めるので、保持ポリシー
-- （purge_article_bodies）で content_text と一緒に必ず落とすこと。
-- 落とし忘れると、消したつもりの本文が HTML 側に残り続ける。

alter table articles
  add column if not exists content_html text;

comment on column articles.content_html is
  '消毒済みの本文HTML。描画用。要約と検索はテキスト側（content_text）を使う。';

-- 保持ポリシーに content_html を足す。
-- 中身は 0005 のものと同じで、落とす列だけ増やしている。
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
         content_ok   = false
   where (a.content_text is not null or a.content_html is not null)
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
  '購読者全員が読み終えて保持期間を過ぎた記事の本文（テキストとHTML）を落とす。pg_cron から毎日呼ぶ。';
