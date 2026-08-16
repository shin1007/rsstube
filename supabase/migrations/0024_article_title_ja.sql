-- 訳した見出しを articles にも持たせる。検索のため。
--
-- 一覧と本文は summaries.title_ja を出すようにしたが（0023）、**検索は
-- articles.title しか見ていなかった**。英語のフィードは記事の42%を占めるので、
-- 画面に出ている日本語の語で検索しても1件も当たらない、という状態だった。
-- 見えているものが引けないのは、検索として成り立っていない。
--
-- PostgREST は埋め込んだ表の列で親を絞れない（0007 の order と同じ事情）。
-- なので importance と同じく複製する。書き込むのはトリガだけ。
--
-- ついでに PGroonga の索引も張る（0015 と同じ理由。日本語は tsvector が効かない）。

alter table articles add column if not exists title_ja text;

comment on column articles.title_ja is
  'summaries.title_ja の複製。検索用。書き込むのはトリガだけ。';

-- 既にあるぶんを写す。
update articles a
   set title_ja = s.title_ja
  from summaries s
 where s.article_id = a.id
   and a.title_ja is distinct from s.title_ja;

create or replace function sync_article_title_ja()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update articles set title_ja = null where id = old.article_id;
    return old;
  end if;

  update articles set title_ja = new.title_ja where id = new.article_id;
  return new;
end $$;

drop trigger if exists summaries_sync_title_ja on summaries;

create trigger summaries_sync_title_ja
  after insert or update of title_ja or delete on summaries
  for each row execute function sync_article_title_ja();

create index if not exists articles_title_ja_pgroonga_idx
  on articles using pgroonga (title_ja);

comment on index articles_title_ja_pgroonga_idx is
  '訳した見出しの日本語検索用。simple 辞書の tsvector は日本語を切れないため PGroonga を使う（0015）。';
