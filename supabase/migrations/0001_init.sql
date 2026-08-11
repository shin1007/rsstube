-- RSSTube 初期スキーマ
-- 個人利用前提だが、最初から user_id + RLS で閉じておく。

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- folders
create table folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------- feeds
create table feeds (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id       uuid references folders (id) on delete set null,
  url             text not null,
  site_url        text,
  title           text not null default '',
  -- 条件付きGET用。前回レスポンスの値をそのまま返す。
  etag            text,
  last_modified   text,
  last_fetched_at timestamptz,
  -- 連続失敗回数。増えるほど巡回間隔を空けてバックオフする。
  error_count     int  not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (user_id, url)
);

create index feeds_due_idx on feeds (last_fetched_at nulls first);

-- ---------------------------------------------------------------- articles
create table articles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feed_id      uuid not null references feeds (id) on delete cascade,
  guid         text,
  url          text not null,
  -- 正規化URL(トラッキングパラメータ除去)のsha256。フィードを跨いだ重複も弾く。
  url_hash     text not null,
  title        text not null default '',
  author       text,
  published_at timestamptz,
  excerpt      text,
  -- 本文。Readabilityで取れたら本文、失敗したらRSSのdescriptionを入れる。
  content_text text,
  -- true = 本文抽出に成功。false = RSS抜粋のフォールバック。表示とAI要約で区別する。
  content_ok   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, url_hash)
);

create index articles_feed_published_idx on articles (feed_id, published_at desc nulls last);
create index articles_user_published_idx  on articles (user_id, published_at desc nulls last);

-- 日本語も引ける全文検索。形態素解析拡張はSupabaseに無いので
-- simple辞書のtsvector(語境界の粗い一致)とtrigram(部分一致)を併用する。
create index articles_fts_idx on articles
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content_text, '')));
create index articles_title_trgm_idx on articles using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------- article_states
create table article_states (
  article_id  uuid primary key references articles (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  is_read     boolean not null default false,
  is_starred  boolean not null default false,
  read_later  boolean not null default false,
  read_at     timestamptz,
  -- NotebookLMへ書き出した日時。二重投入を防ぐ印。
  exported_at timestamptz,
  updated_at  timestamptz not null default now()
);

create index article_states_unread_idx  on article_states (user_id) where not is_read;
create index article_states_later_idx   on article_states (user_id) where read_later;
create index article_states_starred_idx on article_states (user_id) where is_starred;

-- ---------------------------------------------------------------- summaries
create table summaries (
  article_id uuid primary key references articles (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- ["要点1", "要点2", "要点3"]
  bullets    jsonb not null default '[]'::jsonb,
  tags       text[] not null default '{}',
  -- 0-100。トリアージのソートと日次ダイジェストの選抜に使う。
  importance int not null default 50,
  model      text not null,
  created_at timestamptz not null default now()
);

create index summaries_importance_idx on summaries (user_id, importance desc);

-- ---------------------------------------------------------------- exports
-- NotebookLMへ渡すためにまとめたMarkdown1件ぶん。
create table exports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('manual', 'digest')),
  title         text not null,
  markdown      text not null,
  -- NotebookLMの「音声概要をカスタマイズ」欄に貼る指示文。
  prompt        text not null default '',
  drive_file_id text,
  drive_url     text,
  article_ids   uuid[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index exports_created_idx on exports (user_id, created_at desc);

-- ---------------------------------------------------------------- digests
create table digests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  export_id   uuid references exports (id) on delete set null,
  -- 自前音声(P4)を実装したときに media を紐づける。それまではnull。
  media_id    uuid,
  article_ids uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------------------------------------------------------------- jobs
-- 無料枠のレート制限に合わせて少しずつ処理するための単純なキュー。
create table jobs (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('extract', 'summarize', 'digest', 'script', 'tts')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts    int not null default 0,
  next_run_at timestamptz not null default now(),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ワーカーが「実行可能なジョブ」を引くための索引。
create index jobs_claim_idx on jobs (next_run_at) where status = 'queued';
-- 同じ対象を二重にキューしない。
create unique index jobs_pending_unique_idx on jobs (type, (payload ->> 'article_id'))
  where status in ('queued', 'running');

-- ---------------------------------------------------------------- settings
create table settings (
  user_id            uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- NotebookLMの音声概要カスタマイズ欄に貼る指示文のテンプレート。
  notebooklm_prompt  text not null default '日本語で話してください。専門外の聴き手に向けて、各記事について「何が新しいのか」「なぜ重要か」を中心に、10分程度で解説してください。',
  digest_hour        int  not null default 6,
  digest_count       int  not null default 8,
  summary_language   text not null default 'ja',
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table folders        enable row level security;
alter table feeds          enable row level security;
alter table articles       enable row level security;
alter table article_states enable row level security;
alter table summaries      enable row level security;
alter table exports        enable row level security;
alter table digests        enable row level security;
alter table jobs           enable row level security;
alter table settings       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'folders', 'feeds', 'articles', 'article_states',
    'summaries', 'exports', 'digests', 'jobs'
  ] loop
    execute format(
      'create policy %I_owner on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t, t
    );
  end loop;
end $$;

create policy settings_owner on settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
