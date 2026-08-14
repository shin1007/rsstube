-- Google Drive 連携（P2 の残り）。
--
-- NotebookLM は Google ドライブ上の Google Docs をソースとして直接選べる。
-- いまは「.md を落として NotebookLM にアップロードする」二段構えだが、Drive に
-- 置いておけば「ソースを追加 → Google ドライブ → 選ぶ」で済む。
--
-- 保存するのはリフレッシュトークン。これがあれば、こちらの都合でいつでも
-- アクセストークンを取り直せる（毎朝のダイジェストを自動で置くのに要る）。
--
-- **RLS のポリシーを1つも作らない。** enable した上でポリシーが無ければ、
-- Secret キー以外からは読めも書けもしない。リフレッシュトークンは
-- 「そのユーザー本人にも API 越しには見せない」ほうが安全で、
-- 接続しているかどうかはサーバー側（Secret キー）で確かめて画面に返せば足りる。

create table google_accounts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  -- 一度きりしか渡されないので、取りこぼすと接続しなおしになる。
  refresh_token text not null,
  -- 使い回せる間は取り直さない。切れる少し前に更新する。
  access_token  text,
  expires_at    timestamptz,
  -- どのアカウントに繋いだかを画面に出すため。
  email         text,
  -- 書き出し先のフォルダ。drive.file の範囲なので、自分が作ったものだけ触れる。
  folder_id     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table google_accounts enable row level security;
-- ポリシーは作らない（上のコメントの理由）。

comment on table google_accounts is
  'Google Drive のトークン。ポリシーを作っていないので Secret キーからしか触れない。';
