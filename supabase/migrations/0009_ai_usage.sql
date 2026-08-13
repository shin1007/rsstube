-- Gemini の使用量。
--
-- 無料枠には RPD（1日あたりのリクエスト数）の上限がある。フィードを増やすと
-- 要約の呼び出しも比例して増えるが、いま何回使っているのかがアプリから
-- 見えないので、上限に当たって初めて気づくことになる。上限に当たると
-- ジョブは 429 でバックオフし、要約が静かに遅れ続ける。
--
-- 呼び出しごとに行を作ると（1日数十〜数百行）掃除が要るので、日×モデルで集計する。

create table ai_usage (
  -- 日本時間の日付。Google 側の日次リセットは太平洋時間なので、この「1日」は
  -- 無料枠の枠そのものとはずれる。消費のペースを見るための目安として使う。
  day           date   not null default (now() at time zone 'Asia/Tokyo')::date,
  model         text   not null,
  calls         int    not null default 0,
  -- 失敗も呼び出しとして数えられることがあるので、別に持っておく。
  failures      int    not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, model)
);

-- 使用量は API キー単位のもので、ユーザーごとではない（記事・要約と同じ扱い）。
alter table ai_usage enable row level security;
create policy ai_usage_read on ai_usage for select to authenticated using (true);
-- 書き込むのは Secret キーを使うワーカーだけなので、書き込みポリシーは作らない。

/*
 * 呼び出し1回ぶんを足し込む。
 *
 * ワーカーは並行して走り得る（pg_cron の5分毎の実行が前の実行と重なる）ので、
 * 読んでから書くのではなく、1文の upsert で加算する。
 */
create or replace function record_ai_usage(
  p_model  text,
  p_input  bigint,
  p_output bigint,
  p_ok     boolean
) returns void
language sql
security definer
set search_path = public
as $$
  insert into ai_usage (day, model, calls, failures, input_tokens, output_tokens)
  values (
    (now() at time zone 'Asia/Tokyo')::date,
    p_model,
    1,
    case when p_ok then 0 else 1 end,
    greatest(p_input, 0),
    greatest(p_output, 0)
  )
  on conflict (day, model) do update set
    calls         = ai_usage.calls         + 1,
    failures      = ai_usage.failures      + case when p_ok then 0 else 1 end,
    input_tokens  = ai_usage.input_tokens  + greatest(p_input, 0),
    output_tokens = ai_usage.output_tokens + greatest(p_output, 0);
$$;

comment on function record_ai_usage(text, bigint, bigint, boolean) is
  'Gemini の呼び出しを日×モデルで足し込む。失敗も1回として数え、failures にも入れる。';
