-- 「書き出しが毎回同じ」記事を、本文ではなく枠として扱う。
--
-- 0016 では本文が**丸ごと**一致するものを弾いた。エラーページには効くが、
-- 東洋経済のように「ナビゲーション＋会員登録の壁」を掴んでいる場合には効かない。
-- 記事ごとに末尾が少し違うので全文は一致しないためで、実際 13 件が
-- 「本文が取れた」ことになっていた。中身は約4000字のメニューで、記事は1文字も無い
-- （本文は会員登録の向こう側にあり、HTML にそもそも存在しない）。
--
-- 見るところを「冒頭200字」に変える。枠を掴んでいれば書き出しは毎回同じで、
-- 本物の記事なら書き出しが違う。実データ814件で試すと、引っかかったのは
-- 東洋経済の13件だけで、他のフィードは1件も該当しなかった。
--
-- 全文一致は、この規則の特別な場合（200字未満なら全文を見ることになる）なので、
-- 列は増やさず content_hash の中身を入れ替える。

-- 冒頭200字（空白を詰めたもの）のハッシュに置き換える。
-- 詰め方と長さは lib/feeds/content.ts と揃えること。
update articles
   set content_hash = encode(
         sha256(convert_to(left(regexp_replace(btrim(content_text), '\s+', ' ', 'g'), 200), 'UTF8')),
         'hex')
 where content_ok
   and content_text is not null
   and length(btrim(content_text)) >= 100;

-- いま枠を掴んでいる記事を、本文なしに戻す。
--
-- 本文の代わりに RSS の抜粋を入れておく。東洋経済の抜粋は本物のリード文なので、
-- メニューを読ませるより要約の材料としてずっとまともになる。
with boilerplate as (
  select content_hash, feed_id
    from articles
   where content_ok and content_hash is not null
   group by content_hash, feed_id
  having count(*) > 1
)
update articles a
   set content_ok = false,
       content_hash = null,
       -- 抜粋が無ければ、掴んだものをそのまま残す（表示では「取得できず」と出る）。
       content_text = coalesce(a.excerpt, a.content_text)
  from boilerplate b
 where a.feed_id = b.feed_id
   and a.content_hash = b.content_hash;
