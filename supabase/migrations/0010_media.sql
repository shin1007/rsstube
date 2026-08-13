-- 自前の音声とスライド（P4 / P5）。
--
-- NotebookLM に投げる経路（P2）はそのまま残す。こちらは「アプリを開くだけで
-- 音声が溜まっていて、そのまま連続再生できる」ための道で、毎回 NotebookLM を
-- 手で開くのが面倒になったとき用。
--
-- 重要な設計判断: 音声はセグメント単位で作って保存する。
-- 台本をスライド1枚ぶんごとに区切って個別のクリップにすると、
--   - クリップの切れ目＝スライドの切り替わりになり、音声とスライドの
--     タイミングを推定する処理が丸ごと要らなくなる
--   - TTS の1リクエストが短く済み、失敗時の再試行が安い
--   - 途中から再生・スキップが自然にできる
-- 代わりに行数は増えるが、1本あたり十数〜数十行なので問題にならない。

create table media (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 記事1件ぶんの深掘りか、その日のダイジェストか。
  kind        text not null check (kind in ('article', 'digest')),
  article_id  uuid references articles (id) on delete cascade,
  digest_id   uuid references digests (id) on delete cascade,
  title       text not null default '',
  status      text not null default 'queued'
              check (status in ('queued', 'scripting', 'synthesizing', 'ready', 'failed')),
  -- 2話者の対話台本。セグメントに割る前の生成結果をそのまま残す
  -- （作り直すときに Gemini を呼び直さずに済む）。
  script      jsonb not null default '[]'::jsonb,
  -- スライド。台本と同時に作る（切れ目を一致させるため）。
  slides      jsonb not null default '[]'::jsonb,
  duration_sec int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 同じ対象を二重に音声化しない。
  unique (user_id, kind, article_id, digest_id)
);

create index media_user_created_idx on media (user_id, created_at desc);
create index media_ready_idx on media (user_id, created_at desc) where status = 'ready';

create table media_segments (
  media_id     uuid not null references media (id) on delete cascade,
  -- 再生順。台本の並びそのもの。
  idx          int  not null,
  -- どのスライドを出しているか。media.slides の添字。
  slide_idx    int  not null default 0,
  speaker      text not null default '',
  -- 字幕として出すテキスト。台本の1発話ぶん。
  text         text not null default '',
  -- Storage 上の場所。まだ合成していなければ null。
  audio_path   text,
  duration_sec numeric(8, 2) not null default 0,
  primary key (media_id, idx)
);

-- ---------------------------------------------------------------- RLS
alter table media          enable row level security;
alter table media_segments enable row level security;

create policy media_owner on media
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- セグメントは親をたどって判定する。行数が多いので、media 側の主キー索引で引ける
-- exists にしておく。
create policy media_segments_owner on media_segments
  for all
  using (exists (select 1 from media m where m.id = media_id and m.user_id = auth.uid()))
  with check (exists (select 1 from media m where m.id = media_id and m.user_id = auth.uid()));

-- ---------------------------------------------------------------- ストレージ
-- 非公開バケット。配信は署名付きURLで行う。
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- パスは {user_id}/{media_id}/{idx}.mp3。先頭のフォルダ名が持ち主になる。
-- 書き込むのは Secret キーを使うワーカーだけなので、読み取りだけ許す。
create policy media_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------- 保持
-- 音声は Storage の無料枠(1GB)を確実に食う。10分の MP3 が約4.6MB なので、
-- 毎朝1本なら1GBで半年ほど持つ計算だが、記事単位の深掘りが増えると読めない。
-- 古いものから消す。行を消すと Storage のファイルは残るので、
-- 消す対象はワーカー側で拾って先にファイルを消す（lib/media/purge.ts）。
alter table settings
  add column if not exists media_retention_days int not null default 30;

comment on column settings.media_retention_days is
  '生成した音声を保持する日数。0で無効（消さない）。Storage の無料枠は1GB。';

comment on table media is
  '自前生成の音声とスライド。セグメント単位で保存し、切れ目をスライドの切り替わりに使う。';
