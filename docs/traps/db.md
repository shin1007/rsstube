# 踏んだ罠 — DB・Server Action・依存

Supabase · PostgREST · actions/ · 追加した依存 を触るときに読む。索引は `CLAUDE.md` にある。

**ここに書くのは「決まったこと」ではなく「実際に壊れた話」だけ。**
同じ壊れ方をもう一度させないための記録なので、直し方だけでなく
「どう見えたか（何が起きているように見えたか）」を残すこと。

- **バックアップにテーブルを足し忘れると誰も気づかない。** `scripts/db-tables.mjs` が
  一覧で、0005 で切り出した `subscriptions` が長らく漏れていた（復元しても購読ゼロ）。
  jsonb 列は JSON 文字列にしてから戻すこと。JS の配列のまま渡すと pg が
  Postgres の配列に直してしまい `invalid input syntax for type json` になる
  （`text[]` の列は配列のままで正しいので、値の形では区別できない。列の型を DB に聞く）。

- **日本語の全文検索は PGroonga（0015）。** `simple` 辞書の tsvector は空白で区切るだけで
  日本語の文が丸ごと1語になり、0001 で張ったまま一度も使えていなかった。PGroonga は
  Supabase で `create extension` できる。**索引を張るだけで既存の `ilike` が8.2倍速**に
  なる（PGroonga が `ilike` も肩代わりするため、クエリの書き換えは要らない）。
  `&@~` を使えばさらに25倍だが、PostgREST から演算子を呼べないので RPC が要る。
  trgm と simple の索引は落とした（プランナが選ばなくなったため）。

- **PostgREST の `.order(col, { referencedTable: X })` は親の行順を変えない。**
  埋め込んだ X 側の並びを変えるだけ。`articles` を主に `summaries` を埋め込んで
  重要度順にしていたつもりが、実際は published_at 順のままだった（`0007` で発覚）。
  並べ替えは必ず親テーブルの列で行うこと。`articles.importance` はそのための複製。

- **ローカルで動いても Vercel で落ちる依存がある。** `jsdom@30` が引く
  html-encoding-sniffer が CJS のまま ESM を require していて、dev では通るが
  Vercel の外部モジュール読み込みで `ERR_REQUIRE_ESM`。本文抽出は `linkedom` に変えた。
  依存を足したら本番でも1回叩いて確かめること。

- **`settings` の行が無いと列の既定値は効かない。** 設定画面を一度も保存していないと
  行そのものが無いので、`notebooklm_prompt` の default（0001 に書いてある文面）は
  出てこない。空文字のまま書き出すと、NotebookLM が素の読み上げになる。
  既定値は `lib/export/prompt.ts` に TS 側の定数としても置き、行が無いときはそちらを使う。
  文面を変えるときは 0001 の default と両方を揃えること。

- **`article_states` の upsert は `onConflict: 'article_id,user_id'`。** 0005 で
  主キーが (article_id, user_id) に変わったのに `article_id` だけを指定したままの
  箇所が残っていた（書き出しの送信済みマーク）。1人で使っている間は表に出ないが、
  2人目が同じ記事を書き出した瞬間に他人の行へ当たって弾かれる。

- **Server Action で throw したエラーの文面は、本番では表に出ない。** Next が
  digest に置き換えるので、クライアントに届くのは `Minified React error #441`
  （中身を伏せた Server Components のエラー）だけ。`throw new Error('記事が見つかりません')`
  のような**見せるつもりの文面は値として返す**こと。actions/ には throw のまま
  残っている箇所がまだある（feeds / exports / push / drive）。

- **Server Action の失敗は「押しても何も起きない」に化ける。** Next は投げられた
  エラーを digest に置き換えるので、本番で届くのは `Minified React error #441`
  だけ。`throw new Error('フィードを読めませんでした')` の文面は一度も表に出ない。
  設定の保存ボタンでは、成功しても画面が1ドットも変わらないため、**成功・失敗・
  未送信の3つが全部同じに見えていた**。
  - 見せたい文面は**値として返す**こと。`lib/actions/result.ts` の `attempt()` で
    包めば、中の `throw` をそのまま文面にできる（中の書き方は変えなくてよい）。
  - `attempt()` は `unstable_rethrow()` を通すこと。**`redirect()` と `notFound()` は
    throw で動く**ので、飲み込むと画面遷移が「失敗しました」という文字列に化ける。
  - 素の `<form action={サーバー関数}>` は失敗を出す場所が無い。`ActionForm` を使う。
  - 成功にも手応えを出す。変化が見えない操作（保存・受付）は、文言と時刻を出さないと
    押せたかどうか分からない。
