-- 引いたまま手を付けなかったジョブを、その場でキューに戻す。
--
-- claim_jobs は返す前に status を 'running' にして attempts を +1 する。
-- ところがワーカーは時間予算（TIME_BUDGET_MS）を見ながら回るので、
-- **引いた数と処理した数が一致しない**。TTS は1セグメントに数十秒かかるため、
-- 4件引いて2件で時間切れ、ということが普通に起きる。
--
-- 手を付けなかった2件はそのまま 'running' で残り、0004 の
-- reclaim_stale_jobs が拾い直すまで**15分間なにも起きない**。
-- 5セグメントの音声だと「2件進んでは15分待つ」を繰り返すので、
-- 完成まで異常に時間がかかり、画面上は順番待ちのまま止まって見える。
--
-- さらに悪いことに、拾い直されるたび claim_jobs がまた attempts を +1 する。
-- fail_job の max_attempts は5なので、**一度も実行されていないジョブが
-- 5回の空回りで failed に落ちる**。実際に tts が5件この状態になっていた。
--
-- 手を付けていないので attempts も戻す。時間切れは失敗ではない。

create or replace function release_jobs(job_ids bigint[])
returns int
language sql
as $$
  with released as (
    update jobs
       set status      = 'queued',
           -- 実行していないので回数に数えない。数えると、混んでいるだけの
           -- ジョブが max_attempts に達して勝手に諦められる。
           attempts    = greatest(attempts - 1, 0),
           next_run_at = now(),
           updated_at  = now()
     where id = any(job_ids)
       and status = 'running'
    returning 1
  )
  select count(*)::int from released;
$$;

comment on function release_jobs is
  '引いたまま実行しなかったジョブを即座にキューへ戻す。時間切れは失敗ではないので attempts も戻す。';
