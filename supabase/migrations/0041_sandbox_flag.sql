-- 既に保存してある本文から、古い sandbox の値を落とす。
--
-- 埋め込み動画の iframe には `allow-scripts allow-same-origin allow-presentation`
-- を付けていたが、**WebKit が `allow-presentation` を解釈できず**、埋め込みのある
-- 記事を開くたびに Safari のコンソールへ `invalid sandbox flag` が出ていた。
-- 消毒（lib/feeds/sanitize.ts）は**取り込むときに1回**走るだけなので、
-- コードを直しても**既に入っている記事には届かない**（docs/traps/feeds.md の
-- 「直したら、それが既存の行にも届くか確かめること」）。
--
-- 全部を取り込み直すのは高い（本文の再取得が4000件ぶん走る）ので、書いた文字列を
-- そのまま差し替える。**こちらが書いた並びだけ**を狙っているので、記事側の本文には
-- 当たらない（`allow-scripts allow-same-origin allow-presentation` は sanitize.ts が
-- 組み立てた定数）。
--
-- 実行時点で 44件（本文のある記事 4203件のうち）。

update articles
   set content_html = replace(
         content_html,
         'allow-scripts allow-same-origin allow-presentation',
         'allow-scripts allow-same-origin'
       )
 where content_html like '%allow-presentation%';
