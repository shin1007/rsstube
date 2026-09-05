-- 画面遷移で毎回走る集計を SQL 側にまとめる。
--
-- 0020（未読件数）と同じ趣旨だが、こちらは「行を運ぶ量」ではなく
-- **往復の本数と、同じ表を何度も舐めること**が問題だった。
--
--   pipeline_status()  設定画面の3つの数。それまで exact count を3本、別々に
--                      投げていた（実測でサーバー側 27ms / 63ms / 127ms）。
--                      3本とも articles ⋈ article_states を丸ごと数える同じ走査で、
--                      違うのは filter だけ。1本にまとめれば走査も1回になる。
--
--   recent_tags()      アーカイブの絞り込みに出すタグ。それまでは直近500件の
--                      要約の tags 配列を**アプリまで運んで**（実測 42KB）
--                      JS で数えていた。欲しいのは24語とその件数だけ。
--
-- どちらも security invoker のままにすること。RLS が効いた状態で数えないと、
-- 他人の購読まで混ざる（0020 と同じ注意）。

-- ---------------------------------------------------------------- 取り込みの進み具合

/**
 * 「本文の順番待ち／取れなかった／要約の順番待ち」を1回の走査で数える。
 *
 * 対象は自分が購読しているぶんだけ（記事自体は全ユーザー共通なので、
 * article_states が「自分の記事」の切り出しを兼ねる。0005）。
 */
create or replace function pipeline_status()
returns table (pending_extract bigint, failed_extract bigint, pending_summary bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where a.extracted_at is null),
    count(*) filter (where a.extracted_at is not null and not a.content_ok),
    count(*) filter (where a.extracted_at is not null and su.article_id is null)
  from articles a
  join article_states s on s.article_id = a.id and s.user_id = auth.uid()
  -- 要約はまだ無いほうを数えるので、内部結合にしないこと。
  left join summaries su on su.article_id = a.id
$$;

comment on function pipeline_status() is
  '設定画面の「取り込みの進み具合」3つを1回の走査で返す。exact count を3本投げる代わり。';

-- ---------------------------------------------------------------- タグ

/**
 * アーカイブの絞り込みに出すタグ。直近 p_scan 件の要約から拾って多い順。
 *
 * 全期間から集めると、要約のたびに Gemini が付ける語で発散して使わないタグに
 * 埋まるので、いまも「直近から」という形は変えていない。変えたのは数える場所だけ。
 *
 * 返す列に `count` という名前を使わないこと。language sql でも出力名が
 * 本体から見えるので、集約の count(*) と衝突する。
 */
create or replace function recent_tags(p_scan int default 500, p_limit int default 24)
returns table (tag text, uses bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select su.tags
      from articles a
      join article_states s on s.article_id = a.id and s.user_id = auth.uid()
      join summaries su on su.article_id = a.id
     order by a.published_at desc nulls last, a.id desc
     limit p_scan
  )
  select t.tag, count(*)
    from recent, unnest(recent.tags) as t(tag)
   group by t.tag
   order by count(*) desc, t.tag
   limit p_limit
$$;

comment on function recent_tags(int, int) is
  '直近の要約から多い順にタグを返す。500行を運んで JS で数える代わり。';
