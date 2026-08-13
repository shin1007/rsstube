-- pg_cron によるスケジューラ設定。
--
-- これはマイグレーションではなく、デプロイ先URLが決まってから
-- Supabase の SQL Editor で1回だけ手で流すもの。
-- __APP_URL__ と __CRON_SECRET__ を実際の値に置き換えてから実行する。
--
-- なぜ Vercel Cron ではなくこちらを使うか:
--   Vercel の Hobby プランは cron が「1日1回」までで、1時間毎の巡回ができない。
--   pg_cron なら間隔の制約がなく、Supabase の無料枠に含まれる。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 既存の登録を消してから貼り直せるようにしておく。
select cron.unschedule(jobname)
  from cron.job
 where jobname in ('rsstube-poll', 'rsstube-worker', 'rsstube-purge', 'rsstube-digest');

-- 1時間毎: フィード巡回
select cron.schedule('rsstube-poll', '7 * * * *', $$
  select net.http_post(
    url     := '__APP_URL__/api/cron/poll',
    headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
    timeout_milliseconds := 60000
  );
$$);

-- 5分毎: ジョブワーカー（本文抽出・AI要約）
-- 1回あたりの処理件数はアプリ側で絞ってあるので、無料枠のレート制限に当たりにくい。
select cron.schedule('rsstube-worker', '*/5 * * * *', $$
  select net.http_post(
    url     := '__APP_URL__/api/jobs/run',
    headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
    timeout_milliseconds := 60000
  );
$$);

-- 毎日: 完了ジョブの掃除と、保持期間を過ぎた記事本文の削除。
-- 本文は DB サイズのほぼ全部を占めるので、これが無いと無料枠を静かに使い切る。
select cron.schedule('rsstube-purge', '30 3 * * *', $$
  select purge_jobs();
  select purge_article_bodies();
  select purge_orphan_feeds();
$$);

-- 1時間毎: 毎朝ダイジェスト。
-- 毎時叩くが、実際に作るのは各ユーザーの settings.digest_hour（日本時間）に
-- 一致した回だけ。時刻の判定をアプリ側に持たせているのは、ユーザーごとに
-- 生成時刻を変えられるようにするため（cron の式は1つしか置けない）。
-- :50 なのは、その直前の巡回（:07）とワーカー（*/5）で当日ぶんの記事に
-- 要約が付き終わってから選抜したいため。
select cron.schedule('rsstube-digest', '50 * * * *', $$
  select net.http_post(
    url     := '__APP_URL__/api/cron/digest',
    headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
    timeout_milliseconds := 60000
  );
$$);

-- 確認用:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
