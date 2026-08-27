-- 音声化が「詰む」のを解く。
--
-- 起きていたこと: tts ジョブが 429 で5回試して failed に落ちたあと、
-- `media` の行は `synthesizing` のまま**誰にも触られずに残った**（実際に1本が
-- 8日間この状態だった）。lib/media/jobs.ts の markFailed は、1セグメント
-- 転んだだけで全体を殺さないよう status を意図して動かさない。
-- ところがジョブ側が諦めたあとに media を落とす人がどこにもいなかった。
--
-- 表に出る形は「静かに壊れる」型そのもの:
--   - /listen は ready でも failed でもない行を busy とみなすので、
--     「音声を合成中」とできあがり予定時刻を**永久に出し続ける**
--   - failed ではないので再試行の導線も出ない
--   - requestMedia() は既存行があれば status を見ずに返すため、
--     押し直しても「既に作ってあります」になり二度と作り直せない
--
-- ここでは2つ足す。
--   fail_abandoned_media() … 生きたジョブが1つも無い生成中の media を failed に落とす
--   retry_media()          … 諦めたジョブを積み直す（できている音声は捨てない）

-- ジョブを media から引くための索引。fail_abandoned_media が5分毎に通る。
-- payload ->> 'article_id' の索引（0001）は article_id が無いこの2種類には効かない。
create index if not exists jobs_media_idx on jobs ((payload ->> 'media_id'))
  where type in ('script', 'tts');

-- ---------------------------------------------------------------- 見捨てられた media

/**
 * 生成中のまま、動かす人がいなくなった media を failed に落とす。
 *
 * 「生きたジョブ（queued / running）が1つも無い」を死亡判定にする。
 * fail_job は max_attempts に達するまで queued に戻すので、再試行の途中で
 * 誤って落とすことはない。0004 の拾い直しも running のままにするので同じ。
 *
 * stale_after は**取りこぼしを防ぐためではなく**、media を作ってから
 * script ジョブを積むまでの隙間で落とさないためのもの。
 * requestMedia() は行を作ってからジョブを積むので、その一瞬だけ
 * 「生成中でジョブが無い」状態になる。
 */
create or replace function fail_abandoned_media(stale_after interval default interval '10 minutes')
returns int
language sql
as $$
  with abandoned as (
    update media m
       set status     = 'failed',
           -- 理由が空だと画面に赤い文字が出るだけで何も伝わらない。
           -- ジョブ側の last_error（429 の本文など）が入っていればそれを残す。
           last_error = coalesce(nullif(m.last_error, ''), '生成が途中で止まりました。作り直せます。'),
           updated_at = now()
     where m.status in ('queued', 'scripting', 'synthesizing')
       and m.updated_at < now() - stale_after
       and not exists (
         select 1
           from jobs j
          where j.payload ->> 'media_id' = m.id::text
            and j.status in ('queued', 'running')
       )
    returning 1
  )
  select count(*)::int from abandoned;
$$;

comment on function fail_abandoned_media is
  '生きたジョブが無い生成中の media を failed にする。放っておくと画面に「合成中」が永久に出る。';

-- ---------------------------------------------------------------- 作り直し

/**
 * 諦めた音声を積み直す。
 *
 * **できているセグメントは作り直さない。** 台本づくり（gemini-3.5-flash）は
 * 1日20回しか叩けず、合成も1セグメントぶんの無料枠を食う。全部やり直すと、
 * 詰まった原因が枠切れだったときに同じ枠切れをもう一度踏む。
 *
 * 諦めたジョブは payload をそのまま使えるので、作り直さず status を戻すだけ。
 * 積み直す先が無いとき（ジョブが消えている・台本すら無い）だけ新しく積む。
 *
 * @returns 何から再開したか。'ready' は全部揃っていたのに ready になり損ねていた場合。
 */
create or replace function retry_media(target uuid)
returns text
language plpgsql
as $$
declare
  owner uuid;
begin
  select user_id into owner from media where id = target;
  if owner is null then
    return 'missing';
  end if;

  -- 諦めたジョブをそのまま戻す。時間切れではなく本当の失敗だったので、
  -- attempts は 0 に戻して満額もう一度試させる。
  update jobs
     set status      = 'queued',
         attempts    = 0,
         next_run_at = now(),
         last_error  = null,
         updated_at  = now()
   where payload ->> 'media_id' = target::text
     and status = 'failed';

  -- 台本がまだ無い（セグメントが1つも無い）なら台本から。
  if not exists (select 1 from media_segments where media_id = target) then
    if not exists (
      select 1 from jobs
       where payload ->> 'media_id' = target::text
         and type = 'script'
         and status in ('queued', 'running')
    ) then
      insert into jobs (user_id, type, payload)
      values (owner, 'script', jsonb_build_object('media_id', target));
    end if;

    update media set status = 'queued', last_error = null, updated_at = now() where id = target;
    return 'script';
  end if;

  -- 全部合成済みなのに ready になり損ねていた場合（締めの update が落ちたとき）。
  -- 作り直す必要は無いので、その場で締める。
  if not exists (
    select 1 from media_segments where media_id = target and audio_path is null
  ) then
    update media m
       set status       = 'ready',
           duration_sec = (
             select round(coalesce(sum(duration_sec), 0))
               from media_segments where media_id = target
           ),
           last_error   = null,
           updated_at   = now()
     where m.id = target;
    return 'ready';
  end if;

  -- 合成が残っているセグメントに、生きたジョブが無ければ積む。
  -- jobs_pending_unique_idx は payload ->> 'article_id' を見るので tts には効かない
  -- （article_id が無く、NULL どうしは互いに異なる扱いになる）。重複はここで防ぐ。
  insert into jobs (user_id, type, payload)
  select owner, 'tts', jsonb_build_object('media_id', target, 'idx', s.idx)
    from media_segments s
   where s.media_id = target
     and s.audio_path is null
     and not exists (
       select 1
         from jobs j
        where j.type = 'tts'
          and j.payload ->> 'media_id' = target::text
          and (j.payload ->> 'idx')::int = s.idx
          and j.status in ('queued', 'running')
     );

  update media set status = 'synthesizing', last_error = null, updated_at = now() where id = target;
  return 'tts';
end;
$$;

comment on function retry_media is
  '諦めた音声を積み直す。できているセグメントは作り直さない（無料枠を二度踏まないため）。';
