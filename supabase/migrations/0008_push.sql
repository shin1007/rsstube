-- Web Push の購読先。
--
-- 「毎朝ダイジェストができた」を知らせるためだけに使う。開いていなくても届くのが
-- 大事で、通勤前にアプリを開く動機がこれになる。
--
-- 1ユーザーが複数の端末を登録する（スマホとPC）。端末を区別する ID は
-- ブラウザが発行する endpoint そのものなので、これを主キーにする。
-- 同じ端末で登録し直すと endpoint も変わるため、古い行は残る。使えなくなった
-- 購読先は送信時に 404/410 が返るので、そのとき消す（lib/push/send.ts）。

create table push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- ブラウザの公開鍵と認証シークレット。どちらも本文の暗号化に要る（RFC 8291）。
  p256dh     text not null,
  auth       text not null,
  -- どの端末か分かるようにしておく。同じ機種を2つ登録したときの見分けは付かないが、
  -- 「スマホの登録が残っている」程度は分かる。
  user_agent text,
  created_at timestamptz not null default now(),
  -- 最後に送信できた時刻。届かない登録を見つける手がかり。
  last_sent_at timestamptz
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- 自分の登録だけ読み書きできる。送信するのは Secret キーを使う cron 側で、
-- そちらは RLS を迂回する。
create policy push_subscriptions_owner on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table push_subscriptions is
  'Web Push の購読先。ダイジェスト完成の通知に使う。使えなくなった行は送信時に消える。';
