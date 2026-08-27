-- Google の認証情報を、環境変数からアプリの設定へ移す（2026-08-27）。
--
-- それまで `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` は
-- 環境変数だった。**環境変数はデプロイし直さないと変えられず、Vercel の画面を
-- 触れる人しか設定できない。**接続そのものは各ユーザーが押すだけの操作なのに、
-- その手前が運用作業になっていた（本番には値が入っておらず、押しても
-- 同意画面に行かないまま8日気づかなかった）。
--
-- **OAuth クライアントはアプリに1つ。**ユーザーごとに持つものではない
-- （各ユーザーが持つのは同意の結果＝google_accounts の refresh_token）。
-- なので settings（ユーザーごと）ではなく、1行だけのアプリ設定として持つ。
--
-- `id boolean primary key check (id)` は「行は1つだけ」を DB に守らせるため。
-- true しか入らない主キーなので、2行目の insert が必ず conflict する。
--
-- **RLS のポリシーは1つも作らない。** google_accounts / jobs と同じ扱いで、
-- Secret キーのクライアントからしか触れない。client_secret がログイン中の
-- ブラウザから読めてしまうと、鍵を画面に置いた意味が無くなる。

create table if not exists app_config (
  id                   boolean primary key default true check (id),
  google_client_id     text,
  google_client_secret text,
  updated_at           timestamptz not null default now()
);

alter table app_config enable row level security;

comment on table app_config is
  'アプリ全体で1つの設定。いまは Google OAuth のクライアントだけ。RLS ポリシーは無く、Secret キーからのみ読み書きする。';
comment on column app_config.google_client_id is
  'Google Cloud Console の OAuth クライアント ID。秘密ではない（同意画面のURLに載る）。';
comment on column app_config.google_client_secret is
  'そのシークレット。画面へは返さない（設定済みかどうかだけ出す）。';
