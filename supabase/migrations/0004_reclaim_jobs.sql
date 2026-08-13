-- 取りっぱなしで放置されたジョブを拾い直す。
--
-- claim_jobs は status を 'running' にしてから返すが、ワーカーがそのあと
-- 死ぬと（Vercel の実行時間切れ、デプロイによる中断、手で叩いた実行の中止）
-- 誰も complete_job も fail_job も呼ばないまま 'running' が残る。
-- これは黙って二重に効く:
--   1. そのジョブは二度と実行されない
--   2. jobs_pending_unique_idx が ('queued','running') を対象にしているため、
--      その記事は以後どのルートからも再キューできない（enqueue が 23505 で捨てられる）
-- 実際に summarize が5件、この状態で8時間半止まっていた。
--
-- 対策として claim の前に古い 'running' を 'queued' に戻す。attempts は
-- claim 時にすでに +1 されているので、戻した回数は max_attempts に効く。
-- 無限に拾い直し続けることはなく、いずれ failed に落ちて見えるようになる。

-- ワーカーの maxDuration は60秒。それを大きく超えたものだけを死んだとみなす。
create or replace function reclaim_stale_jobs(stale_after interval default interval '15 minutes')
returns int
language sql
as $$
  with reclaimed as (
    update jobs
       set status      = 'queued',
           next_run_at = now(),
           last_error  = 'ワーカーが完了を報告しないまま停止したため、キューに戻しました。',
           updated_at  = now()
     where status = 'running'
       and updated_at < now() - stale_after
    returning 1
  )
  select count(*)::int from reclaimed;
$$;

-- claim_jobs 側に組み込んでおく。ワーカーは5分毎に必ずここを通るので、
-- 呼び出し側に手当てを足さなくても取りこぼしが自然に回収される。
create or replace function claim_jobs(job_limit int default 10, job_type text default null)
returns setof jobs
language plpgsql
as $$
begin
  perform reclaim_stale_jobs();

  return query
  update jobs
     set status = 'running',
         attempts = attempts + 1,
         updated_at = now()
   where id in (
     select id from jobs
      where status = 'queued'
        and next_run_at <= now()
        and (job_type is null or type = job_type)
      order by next_run_at
      limit job_limit
      for update skip locked
   )
  returning *;
end;
$$;
