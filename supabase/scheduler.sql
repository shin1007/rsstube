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
 where jobname in ('rsstube-poll', 'rsstube-worker', 'rsstube-purge', 'rsstube-digest',
                   'rsstube-media-purge', 'rsstube-warm',
                   'rsstube-warm-morning');

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

-- 毎日: 保持期間を過ぎた音声の削除。
-- SQL 側の掃除と分けてあるのは、Storage のファイルを消すのに API が要るため
-- （行だけ消してもファイルは残り、容量の実体はそちら）。
select cron.schedule('rsstube-media-purge', '45 3 * * *', $$
  select net.http_post(
    url     := '__APP_URL__/api/cron/purge',
    headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
    timeout_milliseconds := 60000
  );
$$);

-- 5分毎: 朝いちばんの待ち時間を消すための「温め」。
--
-- ホーム画面から開く朝の1回は、必ず**冷えた関数**に当たる。本番の実測で
-- 合計 2215ms かかっていた（`/` が 393ms → `/auth/refresh` が 848ms →
-- 本体が 973ms）。同じ経路でも温まっていれば 400ms、トークンまで生きていれば
-- 200ms なので、**待ち時間の8割はコールドスタート**だった。
-- 詳しくは docs/traps/perf.md の「速さを、生きた Cookie でだけ測っていた」。
--
-- **3つとも要る。** 朝は `/`・`/auth/refresh`・（通知から入るなら）`/exports`
-- を通るが、Vercel では**ルートごとに別の関数**なので、1つ温めても
-- 残りは冷えている。`/auth/refresh` は1日1回しか通らないぶん、
-- 温めないと毎朝必ず冷たい。
--
-- **中身のある処理はしない。** どちらも未ログインで叩くので、Cookie を見て
-- 307 を返すだけで DB には触らない。狙いは関数のインスタンスを起こしたままに
-- しておくことだけ。**5分あけた時点で完全に温かくはない**（実測: 直後 93ms、
-- 5分後 554ms、10分後 1150ms、15分後 973ms）。それでも冷え切った 2215ms の
-- 4分の1に収まるので、間隔は5分で止めてある。
-- 認証も要らない（CRON_SECRET を渡さない）——秘密を撒く先を増やさないため。
select cron.schedule('rsstube-warm', '*/5 * * * *', $$
  select net.http_get(url := '__APP_URL__/', timeout_milliseconds := 5000);
  select net.http_get(url := '__APP_URL__/auth/refresh', timeout_milliseconds := 5000);
  select net.http_get(url := '__APP_URL__/exports', timeout_milliseconds := 5000);
$$);

-- 朝だけ1分毎: 実際に開く時間帯は、5分では間に合わない。
--
-- 上の5分毎を入れたあとで測り直したら**まだ冷えていた**（本番の実測で、
-- Cookie を読んで 307 を返すだけの `/` に TTFB 1071ms、朝の3本立てで
-- 合計 3259ms。直前の温めは4分前で、pg_cron の記録は succeeded）。
-- 5分の隙間は、Vercel がインスタンスを落とすには十分ある。
--
-- そこで**実際に開く時間帯だけ**1分毎にする。UTC の 20〜23時 =
-- **日本時間の 5:00〜8:59**（ダイジェストができるのは settings.digest_hour = 6時）。
-- **終日1分毎にはしないこと**——呼び出し回数がそのまま増えるうえ、
-- 日中は使っている本人の操作が温め続けるので要らない。
--
-- **`/exports` も温めること。** 朝の通知（ダイジェストができた）をタップして
-- 開くのは `/exports` で、これも**別の関数**。`/` だけ温めていたので、
-- 通知から入る朝は必ず冷えた関数に当たっていた
-- （通知の行き先は src/app/api/cron/digest/route.ts の `url: '/exports'`）。
select cron.schedule('rsstube-warm-morning', '* 20-23 * * *', $$
  select net.http_get(url := '__APP_URL__/', timeout_milliseconds := 5000);
  select net.http_get(url := '__APP_URL__/auth/refresh', timeout_milliseconds := 5000);
  select net.http_get(url := '__APP_URL__/exports', timeout_milliseconds := 5000);
$$);

-- 確認用:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
