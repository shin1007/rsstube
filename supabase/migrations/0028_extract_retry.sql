-- 本文が取れなかった理由を残し、一度だけ取り直す。
--
-- 実測でひっくり返ったことがある。`docs/site-compat.md` は「取れないのは
-- すべて 403/401/429 で、こちら側に直しどころは無い」と結論づけていたが、
-- 本番で失敗している567件を実際に叩き直すと**中身は3種類に割れた**:
--
--   東洋経済 347件  200 が返るのに本文がHTMLに無い。Readability が掴むのは
--                   グローバルメニュー（「有料会員登録 お知らせ ビジネス…」）で、
--                   0016/0018 の使い回し判定が正しく弾いている。**直しようが無い**
--   Hacker News 185件  リンク先が第三者のサイト。403/401 か、JSでしか描かれないページ。
--                   **直しようが無い**
--   Aeon 21件ほか   **いま叩き直すと2万字の本文が取れる。**取り込んだ直後に
--                   一度失敗しただけで、以後だれも取り直していなかった
--
-- 3つ目が抜けていた。`extracted_at` が入った時点で「処理済み」になり、
-- 取れなかった記事は**二度と取りに行かない**。相手の一時的な不調・公開直後の
-- CDN・20秒のタイムアウトで落ちたぶんが、そのまま永久に「本文なし」で残る。
--
-- かといって全部を取り直してはいけない。東洋経済と Hacker News で毎日20件ぶん、
-- 何も変わらないと分かっている取得を繰り返すことになる。**理由を残して、
-- あとで変わりうるものだけを1回だけ取り直す。**

alter table articles
  add column if not exists extract_fail text,
  add column if not exists extract_attempts int not null default 0;

comment on column articles.extract_fail is
  '本文を取れなかった理由。blocked=403等 / notfound=404 / network=切断・時間切れ・5xx / '
  'nonhtml=HTMLでない / short=短すぎ / recycled=メニューや同意画面を掴んだ。null は成功か未処理。';

comment on column articles.extract_attempts is
  '本文抽出を試みた回数。lib/feeds/retry.ts の MAX_ATTEMPTS で頭打ちにする。';

-- 既存ぶんは理由が分からないので埋めない（null のまま）。
-- 推測で入れると、あとで数えたときに実測と区別が付かなくなる。

-- ---------------------------------------------------------------- フィード別の読めなさ

/**
 * フィードごとの「本文が取れている率」。
 *
 * 取得は 200 で成功し続け、更新も止まっていないのに、**要約が RSS の抜粋だけから
 * 作られている**フィードがある（東洋経済は427件中347件＝81%）。この状態は
 * error_count にも last_article_at にも出ないので、設定画面を眺めても分からない。
 * 購読をやめるかどうかは持ち主の判断なので、数字だけ出す。
 *
 * 直近60日に絞るのは「いまどうか」を出すため。サイトの作りが変わって読めるように
 * なったフィードが、昔の失敗を引きずって警告され続けるのを避ける。
 *
 * security invoker のままにすること（0020 と同じ理由）。articles は全ユーザー
 * 共通なので実害は無いが、RLS を外す癖をここで作らない。
 */
create or replace function feed_content_stats()
returns table (feed_id uuid, extracted bigint, unreadable bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.feed_id,
         count(*),
         count(*) filter (where not a.content_ok)
    from articles a
   where a.extracted_at is not null
     and a.published_at > now() - interval '60 days'
   group by a.feed_id
$$;

comment on function feed_content_stats() is
  'フィード別に「本文を取れた／取れなかった」件数を返す。設定画面の健康診断で使う。';
