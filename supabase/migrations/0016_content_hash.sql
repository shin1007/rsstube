-- 同じ本文が使い回されている記事を見つけられるようにする。
--
-- エラーページ・同意画面・「アクセスが集中しています」の類は、どのURLで開いても
-- **同じものが返る**。長さはあるので閾値では弾けず、いまの作りだと本文として
-- 保存され、そのまま AI に渡って要約される。
--
-- 判定の材料はいくつか実データで比べたが、これ以外は使えなかった:
--
--   RSSタイトルとの照合  ペイウォールは題名だけ出すので、成功と失敗を分けられない
--                        （成功12/12・失敗8/10でどちらにも題名があった）
--   定型文のマーカー      誤検出が多い。8件中4〜5件が本物の記事だった
--                        （アクセス解析の記事の "unusual traffic"、
--                          野生動物保護の記事の "forbidden" など）
--   末尾の繰り返し        フッターを拾うだけ。WIRED は34件中29件が
--                        ポッドキャスト宣伝で終わるが、本文はちゃんとある
--
-- 「本文が丸ごと同一」なら、**本物の記事どうしで一致することが原理的に無い**。
-- フッターが同じでも本文が違えば一致しないので、誤検出が起きない。
-- 実際、いまの814件で完全一致する組は0だった（入れても既存の記事は1件も落ちない）。

alter table articles
  add column if not exists content_hash text;

comment on column articles.content_hash is
  '抽出した本文のハッシュ。同じフィード内で衝突したら、記事ではなく使い回しのページとみなす。';

-- 探すのは「同じフィードの中に同じ本文があるか」だけなので、この2列で足りる。
create index if not exists articles_feed_content_hash_idx
  on articles (feed_id, content_hash) where content_hash is not null;

-- 既存ぶんを埋める。空白の詰め方は取り込み側（lib/feeds/content.ts）と揃えること。
update articles
   set content_hash = encode(sha256(convert_to(regexp_replace(btrim(content_text), '\s+', ' ', 'g'), 'UTF8')), 'hex')
 where content_hash is null
   and content_ok
   and content_text is not null
   and length(btrim(content_text)) >= 100;
