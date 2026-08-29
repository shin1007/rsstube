-- パスキー（WebAuthn）でログインできるようにする（2026-08-29）。
--
-- パスワードは残す。パスキーは端末に紐づくので、端末を替えたときや、
-- 生体認証が通らないときに戻る先が要る。**パスキーだけにしないこと。**
--
-- Supabase の Auth に WebAuthn は無い（2026-08 時点）。なので検証はこちらでやり、
-- 通ったら Secret キーでマジックリンクを1本作って、その token_hash を
-- 自分で verifyOtp する——という形でセッションを作る（lib/auth/passkey-session.ts）。
--
-- **RLS は select と delete だけ開ける。** 登録（insert）と counter の更新は
-- Secret キーのクライアントからしか行わない。ログイン中のブラウザから公開鍵や
-- counter を書き替えられると、鍵を持たない相手が「登録済みの端末」を
-- 名乗れることになる。jobs / app_config と同じ扱い（0005 / 0033）。

create table if not exists passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- ブラウザが返す credential ID（base64url）。**全体で一意。**
  -- 同じ鍵が2人にぶら下がると、ログイン時に誰か決められない。
  credential_id text not null unique,
  -- 公開鍵。COSE のバイト列を base64url にして入れる。
  public_key    text not null,
  -- 認証器が「何回使ったか」。増えていなければ複製を疑う（0 を返す器も多い）。
  counter       bigint not null default 0,
  -- 'internal'（端末の生体認証）/ 'usb' / 'nfc' など。次に出す選択肢の並びに使う。
  transports    text[],
  -- 端末に閉じた鍵か、同期される鍵か。これが 'singleDevice' の鍵は、
  -- その端末を失くすと戻せない（＝パスワードが最後の綱になる）。
  device_type   text,
  backed_up     boolean not null default false,
  -- 「iPhone」「仕事のPC」など、人が見分けるための名前。
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists passkeys_user_idx on passkeys (user_id);

alter table passkeys enable row level security;

drop policy if exists passkeys_select_own on passkeys;
create policy passkeys_select_own on passkeys
  for select using (user_id = auth.uid());

-- 消すのは持ち主だけ。**消せることは大事**で、失くした端末の鍵を残したままには
-- できない。書けなくても消せれば、設定画面から手当てができる。
drop policy if exists passkeys_delete_own on passkeys;
create policy passkeys_delete_own on passkeys
  for delete using (user_id = auth.uid());

comment on table passkeys is
  'WebAuthn の公開鍵。insert / update は Secret キーからのみ。select と delete は持ち主。';

-- チャレンジ（1回きりの乱数）。
--
-- **Cookie に入れないこと。** チャレンジは「こちらが今出したもの」であることに
-- 意味がある。ブラウザ側に置くと、盗んだ署名に合わせてこちらの控えごと
-- 差し替えられるので、使い回しを防げなくなる。行は使ったら消す。
--
-- ログイン前にも作るので user_id は null を許す（誰の鍵かは署名を検証してから分かる）。
create table if not exists webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  challenge  text not null,
  -- 'register' か 'authenticate'。登録用のチャレンジでログインを通されないように、
  -- 取り出すときに突き合わせる。
  kind       text not null check (kind in ('register', 'authenticate')),
  user_id    uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_created_idx on webauthn_challenges (created_at);

alter table webauthn_challenges enable row level security;

comment on table webauthn_challenges is
  '発行したチャレンジ。RLS ポリシーは無く Secret キーからのみ。使ったら消す。古いものは発行のたびに掃除する。';
