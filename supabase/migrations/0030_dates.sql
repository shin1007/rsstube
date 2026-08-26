-- 日付の穴を、こちらが手を動かさなくても塞げるようにする。
--
-- `JST` を読めるようにした（lib/feeds/date.ts）が、それだけでは**これから入る
-- 記事にしか効かない**。既に入っている千葉県の103件は url_hash が既出なので
-- 取り込みで上書きされず、日付なしのまま末尾に沈み続ける。
--
-- そして同じことは必ずまた起きる。`MSK` `CEST` のように表に無い略号を使う
-- フィードを登録したら、また静かに日付が欠ける。そのたびに手で UPDATE を
-- 流すのでは、気づいた人がいるときしか直らない。
--
-- ここでは2つ用意する。
--   backfill_published_at()  取り込みのついでに、日付が空いている既存行を埋める
--   feed_content_stats()     日付が入っていない件数も数え、健康診断に出す

-- ---------------------------------------------------------------- 埋め戻し

/**
 * 日付が null の記事に、フィードが持っている日付を入れ直す。
 *
 * **全記事を浚う処理ではない。** 対象はその回の取得に入っていた項目だけ
 * （フィード1本ぶん、多くても100件程度）。CLAUDE.md の「後から全記事を浚う
 * 処理を足さない」に反しないのはこのため——要るときに、手元にあるぶんだけ直す。
 *
 * **既に日付がある行には触らない。** 相手が日付を打ち直すことがあり、
 * 上書きすると既読の並びが動く。空いているところだけ埋める。
 *
 * @param pairs [{"h": url_hash, "d": ISO8601}, ...]
 * @returns 埋めた件数
 */
create or replace function backfill_published_at(pairs jsonb)
returns int
language plpgsql
as $$
declare
  filled int;
begin
  with p as (
    select x->>'h' as url_hash, (x->>'d')::timestamptz as published_at
      from jsonb_array_elements(pairs) x
  )
  update articles a
     set published_at = p.published_at
    from p
   where a.url_hash = p.url_hash
     and a.published_at is null;

  get diagnostics filled = row_count;
  return filled;
end $$;

comment on function backfill_published_at is
  '取り込み時に、日付が空いている既存記事へフィードの日付を入れ直す。埋まっている行には触らない。';

-- ---------------------------------------------------------------- 健康診断に出す

/**
 * 日付なしも数える。
 *
 * 日付が欠けても取得は成功し、本文も要約も普通に付くので、**どの数字にも
 * 出ない**。一覧は nulls last なのでその記事が末尾に沈むだけで、
 * 見ている側には「新着が来ていない」としか映らない（千葉県の103件がそうだった）。
 *
 * 略号を先回りで全部表に入れることはできないので、**欠けたことが見える**ように
 * しておく。次に知らない略号のフィードを登録しても、設定画面に出る。
 */
drop function if exists feed_content_stats();

create or replace function feed_content_stats()
returns table (feed_id uuid, ingested bigint, extracted bigint, unreadable bigint, undated bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.feed_id,
         -- 取り込んだ数。日付なしの母数はこちら（抽出できたかどうかとは無関係）。
         count(*),
         count(*) filter (where a.extracted_at is not null),
         count(*) filter (where a.extracted_at is not null and not a.content_ok),
         count(*) filter (where a.published_at is null)
    from articles a
   where a.created_at > now() - interval '60 days'
   group by a.feed_id
$$;

comment on function feed_content_stats() is
  'フィード別に「取り込んだ／本文を取れた／取れなかった／日付が無い」件数を返す。設定画面の健康診断で使う。';
