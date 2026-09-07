-- 一覧を「1往復」で取れるようにする。
--
-- ここまでの一覧は、こういう順番で**直列に2〜3往復**していた:
--
--   1. subscriptions から購読の feed_id を引く（lib/subscriptions.ts）
--   2. 返ってきてから articles を `feed_id in (…)` で引く
--   3. 記事を開いていて位置が出せないときは、前後の id をもう1往復（600件）
--
-- 本番のデータ（記事4875件・購読12本）で1本ずつ計ると、**DB の仕事は
-- 合計 4.5ms しかない**（素の `select 1` が 34.3ms で、それを超えたぶん）:
--
--   購読の feed_id   0.2ms
--   一覧30件（結合4つ・count 付き）  3.8ms
--   前後の id 600件  4.5ms
--
-- つまり払っているのは往復そのもので、0039 で `shell_data()` が4本を1本に
-- まとめたのと同じ形が一覧に残っていた。購読の絞り込みを SQL の中に入れて
-- しまえば、往復は1本で済む。
--
-- **埋め込み（`feeds!inner (subscriptions!inner …)`）に戻したわけではない。**
-- あれは PostgREST が横結合を組み立てるぶんで7倍遅かった（227ms → 31ms）。
-- ここは素の SQL なので、上の 3.8ms がそのまま実測値。
--
-- ついでに2つ消える:
--
--   * **総数を数える口が構造的に1つになる。** `count(*) over ()` は同じ
--     問い合わせの結果を数えるので、絞り込みがずれようがない（「あと12件」と
--     出しておきながら3件目で終わる、が起きない）。PostgREST の
--     `count: 'exact'` が範囲を追い越すと 416 で落ちる話（0038）とも縁が切れる。
--   * **検索の id を URL に並べなくてよくなる。** 0040 の `search_article_ids()`
--     は当たった id をアプリまで運んで `in.(…)` で当て直していたので、
--     **250件で頭打ち**だった（300件＝約11KB までしか URL に載らない）。
--     語の照合をこの中でやれば上限が要らない。深い当たりも全部数えられる。
--
-- security invoker のままにすること。どの記事が「自分のもの」かは RLS が
-- 決める（article_states と subscriptions が自分の行しか返さない）。

/**
 * 時刻は必ず UTC の ISO 8601 で文字にする。
 *
 * `to_jsonb(timestamptz)` は**セッションの時間帯**で書き出すので、接続の
 * 設定ひとつで文字列が変わる。日時の食い違いは画面では「9時間ずれた取得時刻」
 * として出て、しかも手元（日本時間）では再現しない（docs/traps/perf.md）。
 * ここで綴じておけば、受け取る側は今までどおり Date に食わせるだけで済む。
 */
create or replace function iso8601(t timestamptz)
returns text
language sql
immutable
parallel safe
as $$ select to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

comment on function iso8601(timestamptz) is
  'timestamptz を UTC の ISO 8601 文字列にする。to_jsonb はセッションの時間帯で書き出すので使わない。';

/**
 * リーダーの一覧（/）1ページぶんと、いまの絞り込みの総数。
 *
 * @param p_view       unread / starred / later / unsummarized / all
 * @param p_folder     フォルダで絞る（購読側の持ち物なので subscriptions を見る）
 * @param p_feed       フィードで絞る
 * @param p_term       検索語。PGroonga の `&@`（0015・0040）。空なら絞らない。
 *                     **`&@` は問い合わせ構文を解釈しない**ので、記号が入っていても
 *                     構文エラーにならない。下ごしらえ（長さの上限）はアプリ側。
 * @param p_limit      返す件数
 * @param p_offset     何件目から（無限スクロールの継ぎ足し）
 * @param p_with_count 総数も返すか。**1ページ目でだけ true。** 継ぎ足しでは
 *                     要らないうえ、数える窓が全行に乗る。
 * @param p_ids_only   id と日付だけ返す（前後の記事を出すためのぶん）。
 *                     本文も要約も運ばない。
 *
 * 戻りは `{ "articles": [...], "total": 数 | null }`。行の形は
 * lib/types.ts の ArticleRow に合わせてあるので、受け取る側は素通しでよい。
 *
 * **絞り込みと並び順はここが唯一の持ち主。** 一覧・総数・前後の id が同じ
 * 1つの式を使う（以前はアプリ側の applyFilters が持っていた。ずれると
 * 「前後の記事」だけ別の並びを指す）。
 */
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
             when 'later'   then st.read_later = true
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
                       'read_later', st.read_later,
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

comment on function list_articles(text, uuid, uuid, text, int, int, boolean, boolean) is
  'リーダーの一覧1ページぶんと総数。購読の絞り込みも語の照合もここでやるので往復は1回（以前は2〜3回）。';

/**
 * アーカイブ（/library）の検索。
 *
 * **`ilike` をやめて PGroonga の `&@` にする。** 一覧の検索は 0040 で移した
 * のに、こちらだけ取り残されていた。本番のデータで計った DB 側の仕事
 * （素の往復 34.9ms を引いたぶん）:
 *
 *   語     見出しだけ ilike   本文も＝deep の ilike   ここ（&@）
 *   AI       5.9ms /  36件      131.0ms / 41件        5.2ms /  94件
 *   健康     2.4ms /   4件       57.8ms / 41件        2.1ms / 129件
 *   医療     1.9ms /  34件       52.9ms / 41件        2.5ms / 138件
 *
 * 「本文も」を押した瞬間だけ 53〜131ms 働いていたのは、索引が使われていても
 * そのあと候補の本文を取り出して ilike をやり直していたから（0040 と同じ話）。
 * 当たる件数も増える——`&@` は全角と半角・大小文字を正規化する。
 *
 * **関数にしたのは、当たった id を URL に並べなくて済ませるため。**
 * `search_article_ids()` を呼んで `in.(…)` で当て直す形にすると、URL に載る
 * 上限（実測300件・約11KB）で頭打ちになる。アーカイブは「前に読んだあれ」を
 * 掘り返す場所なので、古いほうから切り落とすのは目的と正面から反する。
 *
 * 購読で絞らないのは今までどおり。**購読をやめたフィードの記事も、読んだ
 * ことがあるなら出す**（切り出しているのは article_states の有無だけ）。
 *
 * @param p_deep 本文も対象にする。既定は見出し（原題と訳）だけ。
 * @param p_limit 1件多く頼むこと。「次のページがあるか」はそれで見る。
 */
create or replace function search_library(
  p_term     text    default null,
  p_deep     boolean default false,
  p_tag      text    default null,
  p_starred  boolean default false,
  p_exported boolean default false,
  p_days     int     default null,
  p_limit    int     default 41,
  p_offset   int     default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- **絞り込みと順番・件数はこの中で終わらせる。** 集約の外側に order by や
  -- limit を置くと、まとめたあとの1行のほうに掛かってしまう。
  -- 語に当たる id は先に集める（list_articles と同じ理由）。
  --
  -- **「本文も」は必ず別の枝にすること。** 同じ枝に
  -- `(p_deep and a.content_text &@ p_term)` と書くと、p_deep の値は計画を
  -- 立てる時点では分からないので、**索引を使う計画が立てられない**
  -- ——全行を舐めて1行ずつ本文を照合する形に化ける（実測 256ms。
  -- 見出しだけの同じ関数は 19ms なので、遅いのは本文の枝そのもの）。
  -- 枝を分ければ `p_deep` は行に依らない条件になり、偽なら枝ごと実行されず、
  -- 真なら PGroonga の索引がそのまま効く（実測 3ms）。
  with matched as materialized (
    select a.id
      from articles a
     where coalesce(p_term, '') <> ''
       and (a.title &@ p_term or a.title_ja &@ p_term)
    union
    select a.id
      from articles a
     where coalesce(p_term, '') <> ''
       and p_deep
       and a.content_text &@ p_term
  ),
  hits as (
    select a.id, a.title, a.url, a.author, a.published_at, a.excerpt,
           f.id as feed_id, f.title as feed_title,
           sm.article_id as summary_id, sm.bullets, sm.tags, sm.title_ja,
           st.is_starred, st.exported_at
      from articles a
      join article_states st on st.article_id = a.id
      join feeds f on f.id = a.feed_id
      left join summaries sm on sm.article_id = a.id
     where (coalesce(p_term, '') = '' or a.id in (select m.id from matched m))
       -- タグで絞るときは要約が要る（left join のままだと要約なしが残る）。
       and (p_tag is null or sm.tags @> array[p_tag])
       and (not p_starred or st.is_starred)
       and (not p_exported or st.exported_at is not null)
       and (p_days is null or p_days <= 0
            or a.published_at >= now() - make_interval(days => p_days))
     -- 同着は id で決める（ページの境目で重複・欠落しないように）。
     order by a.published_at desc nulls last, a.id desc
     limit greatest(coalesce(p_limit, 0), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', h.id,
               'title', h.title,
               'url', h.url,
               'author', h.author,
               'published_at', iso8601(h.published_at),
               -- 要点があるときは抜粋を運ばない（リーダーの一覧と同じ）。
               'excerpt', case
                            when jsonb_array_length(coalesce(h.bullets, '[]'::jsonb)) > 0
                            then null else h.excerpt
                          end,
               'feed', case when h.feed_id is null then null
                            else jsonb_build_object('id', h.feed_id, 'title', h.feed_title) end,
               'summary', case when h.summary_id is null then null
                               else jsonb_build_object(
                                 'bullets', coalesce(h.bullets, '[]'::jsonb),
                                 'tags', to_jsonb(coalesce(h.tags, '{}'::text[])),
                                 'title_ja', h.title_ja
                               ) end,
               'state', jsonb_build_object(
                 'is_starred', h.is_starred,
                 'exported_at', iso8601(h.exported_at)
               )
             )
             order by h.published_at desc nulls last, h.id desc
           )
      from hits h
  ), '[]'::jsonb)
$$;

comment on function search_library(text, boolean, text, boolean, boolean, int, int, int) is
  'アーカイブ検索。本文も PGroonga の &@ で引く（ilike だと本文を読み直すぶんが乗る）。';

-- 0040 の `search_article_ids()` は、当たった id をアプリまで運んで
-- `in.(…)` で当て直すための関数だった。語の照合が上の2つの中に入ったので
-- 呼び出し元が無くなる。**残しておくと「どちらが本物か」を次に読む人が
-- 探すことになる**ので消す（0015 の索引はそのまま。上の2つが使っている）。
drop function if exists search_article_ids(text, int);
