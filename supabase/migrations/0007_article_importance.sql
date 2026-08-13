-- 重要度で記事を並べられるようにする。
--
-- 一覧は articles を主にして summaries を埋め込んでいる。そこで
--   .order('importance', { referencedTable: 'summaries' })
-- と書いていたが、PostgREST のこれは「埋め込んだ側の並び」を変えるだけで、
-- 親である articles の行順には効かない。summaries は記事につき1件なので
-- 並べる対象が無く、指定は黙って無視される。
-- 結果として「重要度順」は実際には published_at 順のままだった。
-- 未読207件中194件に要約が付いているのに、一覧の先頭が要約の無い最新記事で
-- 埋まっていたことで発覚した。
--
-- 親テーブルの列なら order できるので、重要度を articles にも持たせる。
-- 正は今までどおり summaries 側で、こちらはトリガで追従させる複製。

alter table articles add column if not exists importance int;

comment on column articles.importance is
  'summaries.importance の複製。並べ替え用。書き込むのはトリガだけ。';

-- 既存ぶんを埋める。
update articles a
   set importance = s.importance
  from summaries s
 where s.article_id = a.id
   and a.importance is distinct from s.importance;

create or replace function sync_article_importance()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update articles set importance = null where id = old.article_id;
    return old;
  end if;

  update articles set importance = new.importance where id = new.article_id;
  return new;
end $$;

create trigger summaries_sync_importance
  after insert or update of importance or delete on summaries
  for each row execute function sync_article_importance();

-- 「重要度順」の実体。要約がまだ無い記事は importance が null になり、
-- nulls last で末尾へ回る。
create index articles_importance_idx
  on articles (importance desc nulls last, published_at desc nulls last);
