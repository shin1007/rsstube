-- 重要度をやめる（2026-09-03 決定）。
--
-- AI に 0〜100 を付けさせ、一覧の並べ替えとダイジェストの選抜に使っていた。
-- やめる理由は、**重要度は記事の属性ではないから**。同じ記事でも、職業が違えば
-- 重要度は違う。同じ部門でも立場が違えば変わる。読み手との関係で決まるものを
-- 記事の側に1つの数値として持たせたのが、そもそもの型の誤りだった。
--
-- 0036 でフォルダごとの重みを掛けて人ごとに寄せようとしたが、あれも外れている。
-- 実データで、話題の軸と情報源の軸は直交していた——「AI」タグの記事は購読12本の
-- うち12本に、「健康」は13本に散っていて、フィードの束（フォルダ）に重みを
-- 掛けても関心は表現できない。タグに寄せる案も同じ穴で、記事に付いた一つの
-- 尺度を人が後から曲げる形に変わりはない。
--
-- 数値を残したまま使わないのは最悪で、画面に出ていれば読む人は必ず意味を探す。
-- 列ごと落とす。
--
-- 巻き添えで落ちるもの:
--   articles.importance          並べ替え用の複製（0007）
--   articles_importance_idx      「重要度順」の実体
--   summaries_sync_importance    複製を追従させるトリガ
--   folders.weight               フォルダごとの重み（0036、1日で撤去）
--
-- 一覧の並び順は新着順だけになる。ダイジェストの選抜は、フォルダごとの上限を
-- 残したまま新しい順に切り替える（lib/digest/select.ts）。偏りを避ける必要は
-- 重要度とは関係なく残っているので、そちらは残す。

drop trigger if exists summaries_sync_importance on summaries;
drop function if exists sync_article_importance();
drop index if exists articles_importance_idx;

alter table articles  drop column if exists importance;
alter table summaries drop column if exists importance;
alter table folders   drop column if exists weight;
