-- schema_migrations に RLS が無かった（Supabase の Security Advisor が拾ったのはこれ）。
--
-- このテーブルだけは migrations/ ではなく scripts/db-migrate.mjs が
-- `create table if not exists` で作っていた。移行を管理する側の道具なので
-- 0001 に書けず、そのぶん「テーブルを作ったら RLS」の手順から外れていた。
--
-- public スキーマに作った表には Supabase が anon / authenticated にも
-- 既定で全権限を渡す。RLS が無いので、**ブラウザに出ている anon キーだけで
-- 誰でも読み書き・削除できる状態**だった。記事の中身は漏れないが、
-- 行を消されると次の db:migrate が 0001 から流し直そうとして落ちるし、
-- 偽の version を入れられれば以後の移行が黙って飛ばされる。
--
-- ポリシーは1つも置かない（jobs と同じ）。所有者の postgres は RLS を
-- 迂回するので db:migrate はそのまま動く。anon / authenticated からは
-- 権限そのものも取り上げる——RLS で止めるより手前で止まる。
alter table if exists schema_migrations enable row level security;

revoke all on table schema_migrations from anon, authenticated;
