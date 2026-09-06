-- 全ページの外枠（サイドバーと下部タブ）が要るものを、1回で返す。
--
-- それまでは毎ページで4本を並べて投げていた:
--   folders / subscriptions+feeds / unread_counts() / 未聴の数
--
-- 並べているので待ち時間は「いちばん遅い1本」だが、**遅いのは DB ではなく
-- PostgREST のほう**だった。素の SQL で測ると4本とも 0.5ms 前後（往復の
-- 下限34msに対して誤差）で、まとめて1本にしても 2.7ms しかかからない。
-- つまりここで削れるのは実行時間ではなく、**HTTP の往復と PostgREST が
-- 問い合わせを組み立てる費用を3回ぶん**。
--
-- security invoker のままにすること。どの行が見えるかは今までどおり RLS が
-- 決める（0020 と同じ注意）。だから user_id の条件をここに書き足さない
-- ——書くと「RLS とこの関数」の2か所が同じことを言う形になり、片方だけ
-- 直す日が来る。
--
-- 並べ替えはアプリでやる。フィードの並びは日本語の localeCompare なので、
-- Postgres の照合順とは一致しない（ここで order by すると見た目が変わる）。

create or replace function shell_data()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'folders', coalesce((
      select jsonb_agg(jsonb_build_object('id', fo.id, 'name', fo.name)
                       order by fo.sort_order, fo.name)
        from folders fo
    ), '[]'::jsonb),

    -- 「自分のフィード」は必ず subscriptions 側から引く。feeds は全ユーザー
    -- 共通で、ログイン済みなら全行読めるため（0005）。
    -- フォルダと表示名は購読ごとの持ち物なので、購読側の値を優先する。
    'feeds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'title', coalesce(nullif(s.title, ''), f.title),
               'url', f.url,
               'folder_id', s.folder_id,
               'error_count', f.error_count,
               'last_error', f.last_error))
        from subscriptions s
        join feeds f on f.id = s.feed_id
    ), '[]'::jsonb),

    -- 未読の数え方は unread_counts() に1つだけ置いておく（0020）。
    -- ここで数え直すと、片方だけ直した日に数字が食い違う。
    'unread', coalesce((
      select jsonb_object_agg(u.feed_id, u.unread) from unread_counts() u
    ), '{}'::jsonb),

    -- 数えるのは ready だけ。生成中を混ぜると、押しても聴けないぶんまで
    -- バッジが出る（lib/media/list.ts の unplayedMediaCount と同じ理由）。
    'unplayed', (
      select count(*) from media where status = 'ready' and played_at is null
    )
  )
$$;

comment on function shell_data() is
  'サイドバーと下部タブが要るもの（フォルダ・購読フィード・未読件数・未聴数）を1回で返す。全ページで通るところなので往復を1本にまとめてある。';
