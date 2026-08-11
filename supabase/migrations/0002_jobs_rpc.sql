-- ジョブキューの取得・完了・失敗を1往復で行うRPC。
-- ワーカーはVercelのサーバーレス関数なので、複数同時に走っても同じジョブを掴まないよう
-- FOR UPDATE SKIP LOCKED で排他する。

create or replace function claim_jobs(job_limit int default 10, job_type text default null)
returns setof jobs
language sql
as $$
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
$$;

create or replace function complete_job(job_id bigint)
returns void
language sql
as $$
  update jobs set status = 'done', last_error = null, updated_at = now() where id = job_id;
$$;

-- 失敗時は指数バックオフで再キュー。max_attempts を超えたら failed に落として諦める。
-- Gemini無料枠の429はここで吸収される想定。
create or replace function fail_job(job_id bigint, err text, max_attempts int default 5)
returns void
language sql
as $$
  update jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         next_run_at = now() + (least(power(3, attempts), 720) || ' minutes')::interval,
         last_error = err,
         updated_at = now()
   where id = job_id;
$$;

-- 完了済みジョブの掃除（pg_cronから毎日呼ぶ）。
create or replace function purge_jobs()
returns void
language sql
as $$
  delete from jobs where status = 'done' and updated_at < now() - interval '7 days';
$$;
