-- 日本語で引ける全文検索。
--
-- これまでの検索の弱点は 0001 のコメントにも README にも書いてあるとおり:
--
--   tsvector('simple')  空白で区切るだけなので、日本語の文が丸ごと1語になる。
--                       索引はあるが実質使えない（0001 で張ったまま使っていない）
--   ilike '%語%'        引けるが索引が効かない。タイトルは trgm で救えるものの、
--                       本文は順スキャンになるので記事が増えると重くなる
--
-- PGroonga は日本語の形態素／N-gram 索引を張れるので、両方まとめて解決する。
-- 「不整脈」のように文の途中にある語も、索引を使って引ける。
--
-- 本文にも索引を張るかは迷うところだが、張る。理由:
--   - 検索が遅いのは「本文も探す」を入れたときで、そこが一番効いてほしい
--   - 本文は保持期間を過ぎると消えるので、索引も無限には育たない
--   - trgm を本文に張るのと違い、PGroonga は日本語向けに圧縮が効く
-- 容量が問題になったら、本文の索引だけ落として（タイトルは残して）調整できる。

create extension if not exists pgroonga;

-- タイトル。一覧の検索はここだけで済むことが多い。
create index if not exists articles_title_pgroonga_idx
  on articles using pgroonga (title);

-- 本文。/library の「本文も探す」で使う。
create index if not exists articles_content_pgroonga_idx
  on articles using pgroonga (content_text);

comment on index articles_title_pgroonga_idx is
  '日本語で引ける全文検索。tsvector(simple) は語境界が取れず、ilike は索引が効かない。';

-- 使わなくなった索引を落とす。索引は書き込みのたびに更新されるので、
-- 抱えているだけ巡回（1時間ごとに数百件 upsert する）が遅くなる。
--
-- articles_fts_idx     simple 辞書の tsvector。日本語で語境界が取れず最初から使えていない
-- articles_title_trgm_idx  タイトルの ilike 用。PGroonga が同じ用途を肩代わりする。
--                      実測でプランナが trgm を選ばなくなり、外しても速度は同じ
--                      （0.46ms → 0.465ms）。1.9MB あるので落とす。
--
-- pg_trgm 拡張そのものは残す（0001 で入れたもの。他で使いたくなったときのため）。
drop index if exists articles_fts_idx;
drop index if exists articles_title_trgm_idx;
