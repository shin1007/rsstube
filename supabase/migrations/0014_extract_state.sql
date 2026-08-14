-- 「まだ本文を取りに行っていない」と「取りに行って失敗した」を区別する。
--
-- これまでは content_ok の false が両方を意味していた。取り込んだ直後の記事も
-- false で入るので、区別する手がかりがどこにも無い。
--
-- 実害はあった。本文抽出の失敗率を数えたとき、キュー待ちの252件を失敗に数えて
-- 「36%が失敗」と読み違えた（処理済みだけで数えると8%）。同じ誤解は画面を見る側でも
-- 起きる。「要約なし」ビューに並ぶ記事が、壊れているのか順番待ちなのか分からない。
--
-- 列は1つだけ足す。extracted_at が null なら未処理で、入っていれば処理済み。
-- 処理済みで content_ok が false なら、取りに行って取れなかったということ。
--
--   extracted_at is null                     まだ取りに行っていない
--   extracted_at is not null かつ content_ok  本文が取れている
--   extracted_at is not null かつ not content_ok  取りに行って取れなかった
--
-- content_ok を残すのは、「本文が手元にあるか」を見たい場所（要約プロンプト・
-- 書き出しの注記・画面の表示）がそのまま使えるため。真偽が2か所に散らないよう、
-- extracted_at は「いつ処理したか」だけを持たせる。

alter table articles
  add column if not exists extracted_at timestamptz;

comment on column articles.extracted_at is
  '本文抽出を試みた時刻。null は未処理。content_ok と組で「未処理／成功／失敗」を表す。';

-- 既存ぶんを埋める。
--
-- 本文が取れているものは、当然もう処理済み。
update articles set extracted_at = created_at
 where extracted_at is null and content_ok;

-- 取れていないものは、まだキューに残っているかどうかで分かれる。
-- 残っていなければ「処理して駄目だった」、残っていれば「順番待ち」。
update articles a
   set extracted_at = a.created_at
 where a.extracted_at is null
   and not a.content_ok
   and not exists (
     select 1 from jobs j
      where j.type = 'extract'
        and j.status in ('queued', 'running')
        and (j.payload ->> 'article_id')::uuid = a.id
   );

-- 「順番待ちがどれだけ溜まっているか」を一覧で出すための索引。
create index if not exists articles_unextracted_idx
  on articles (created_at desc) where extracted_at is null;
