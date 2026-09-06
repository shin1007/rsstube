-- 一覧の検索を、索引が本当に効く形にする。
--
-- 0015 で PGroonga の索引を張ってあり、`explain` を見ると**ちゃんと使われて
-- いた**（BitmapOr が4.5ms）。それでも遅かったのはその後ろで、
-- **Bitmap Heap Scan の recheck が候補1199行ぶんの `content_text` を
-- 取り出して ilike をやり直していた**（613ブロック・99ms）。しかも索引側は
-- 購読も既読も見ないので、捨てる行のために本文を読み出していたことになる。
--
-- `ilike` をやめて PGroonga の `&@` にすると、この読み直しが要らなくなる。
-- 実測（本番と同じデータ・往復の下限35ms）:
--
--   ilike ×3   125ms / 91ms / 77ms   （語によって変わる）
--   &@    ×3    38ms / 38ms / 36ms   ＝ ほぼ往復ぶんだけ
--
-- **当たる件数は減らない。** 実データで11語を突き合わせて、9語は同数、
-- 2語は `&@` のほうが多かった（`AI` 89→93、`令和8年` 312→377）。
-- 増えるのは PGroonga が全角と半角・大小文字を正規化するため
-- （`令和8年` で `令和８年` の記事も当たる）。「整脈」「ンター」のような
-- 語の途中も、bigram なので今までどおり当たる。
--
-- **絞り込みはここに書かない。** 未読・スター・フォルダ・フィードの条件は
-- lib/articles.ts の applyFilters が1か所で持っている（CLAUDE.md）。ここが
-- 返すのは「自分の記事のうち、この語に当たる id」だけで、そこから先の
-- 絞り込みと並び順は今までどおりアプリ側が当てる。一覧・件数・前後の id が
-- 同じ id 集合を使うので、「あと12件」と出して3件目で終わる形にはならない。
--
-- security invoker のままにすること。どれが「自分の記事」かは RLS が決める。

/**
 * 自分の記事のうち、この語に当たるものの id。新しい順。
 *
 * @param p_term  検索語。`&@` は問い合わせ構文を解釈しない（1つの語として
 *                扱う）ので、記号が入っていても構文エラーにならない。
 * @param p_limit 返す上限。**アプリはこれを `in.(…)` で URL に並べる**ので、
 *                無制限にはできない。実測で 300件（約11KB）までは通り、
 *                500件（約19KB）で接続ごと落ちた。既定を 250 にしてあるのは
 *                その手前で止めるため。
 */
create or replace function search_article_ids(p_term text, p_limit int default 250)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id
    from articles a
    join article_states s on s.article_id = a.id
   where p_term <> ''
     and (a.title &@ p_term or a.title_ja &@ p_term or a.content_text &@ p_term)
   order by a.published_at desc nulls last, a.id desc
   limit greatest(p_limit, 0)
$$;

comment on function search_article_ids(text, int) is
  '一覧の検索。PGroonga の &@ で当たった自分の記事の id を新しい順に返す。ilike だと索引の後ろで本文を読み直すぶんが乗る。';

-- 索引は3列とも揃っている（title と content_text が 0015、title_ja が 0024）。
-- ここで足すものは無い。`explain` でも3本とも BitmapOr に並んでいた。
