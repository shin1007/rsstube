@AGENTS.md

# RSSTube — プロジェクトの前提

AI要約つきの個人用RSSリーダー。詳細な設計は `docs/plan.md`、
セットアップ手順は `README.md` を見ること。

## 決まっていること（蒸し返さない）

- **NotebookLM に公開APIは無い**（2026年8月時点。Enterprise版のみ、コンシューマ版は未提供）。
  なので「アプリで整形 → 人が NotebookLM に投入」が P2 の方針。自前音声は後段（P4）。
- **AI は Gemini API の無料枠**を使う。要約 `gemini-3.5-flash-lite`、台本 `gemini-3.5-flash`、
  音声（後段）`gemini-3.1-flash-tts-preview`。いずれも無料枠あり。
- **定期実行は Supabase の `pg_cron`**。Vercel Hobby の cron は1日1回までで
  1時間毎の巡回ができないため。`supabase/scheduler.sql` を参照。
- **Next.js 16.3**。`middleware` は `proxy.ts` に改称、`params`/`searchParams` は Promise、
  Turbopack が既定。訓練データと差異があるので `node_modules/next/dist/docs/` を読むこと（AGENTS.md）。
- **ダークテーマ固定**。朝晩に長時間読む用途のため、切り替えは作らない。
- **記事・要約・フィードは全ユーザー共通**（`0005`/`0006` で実施済み）。
  ユーザーごとなのは `subscriptions` / `article_states` / `folders` /
  `exports` / `digests` / `settings` だけ。ユーザーごとに複製していた頃は
  記事178件＝3.7MB（本文平均8KB）、要約は `BATCH_SIZE = 5` で約36回の Gemini 呼び出しが
  購読者数ぶん掛かる形で、無料枠に収まらなかった。2人目が同じフィードを購読しても
  記事・ジョブは増えず `article_states` だけが増えることを実測で確認済み。
  - `feeds` に書き込みポリシーは無い。購読の入口は `subscribe_feed()` /
    `unsubscribe_feed()` RPC だけ。タイトルや etag の持ち主は巡回であって購読者ではない。
  - 副作用として、ログイン済みなら**全フィードのURLが見える**（誰が購読しているかは見えない）。
    購読 URL 自体を隠したくなったら、そのとき `feeds` の select を絞ること。
  - 要約は共通なので**言語も全体で1つ**しか選べない。当面はオーナーの
    `settings.summary_language` を使う。ユーザーごとに変えるなら
    `summaries` を `(article_id, language)` で持つ必要がある。
- **毎朝ダイジェストの生成時刻はアプリ側で判定する**。pg_cron から毎時叩き、
  各ユーザーの `settings.digest_hour`（日本時間）に一致した回だけ作る。
  cron の式は1つしか置けないので、ユーザーごとの時刻を式では表せないため。
  Vercel Cron を使わないのは1日1回制限に加えて実行時刻が±59分ずれるから
  （6時のダイジェストが7時前にできてしまう）。
- **ダイジェストを作り直すのは「digests の当日行を消してから」**。
  書き出した記事には `exported_at` が付いて選抜から外れるので、`force=1` を
  もう一度叩いても同じものは再現せず、中身の違う2本目ができて1本目が宙に浮く。
  なので `force=1` は生成時刻だけを無視し、当日ぶんの有無は必ず見る。
- **当面は個人用のまま**（2026-08-13 決定）。一般公開は「自分が毎日使えている」状態に
  なってから。費用は無料枠に収まる範囲で設計する。

## 環境

- **このプロジェクトは `C:\dev\rsstube` で開発する。`G:\マイドライブ` 配下には置かない。**
  Google Drive のストリーミングドライブでは `npm install` が `EPERM`→`EBADF` で必ず失敗し、
  `node_modules` を逃がすジャンクションも作れない（Drive の仮想FSが再解析ポイント非対応）。
  同じ install が Drive で10分超＋失敗、`C:\dev` で22秒。
- `G:\マイドライブ\ローカルリポジトリ\RSSTube` に壊れかけの旧コピーが残っている。削除してよい。
- `.env.local` は実値が入っている。Supabase・Gemini とも接続済み。

## 実装済み / 未実装

済: リーダーUI、フィード巡回、本文抽出、AI要約、ジョブキュー、NotebookLM への書き出し
（`.md` ダウンロード／クリップボードコピー／指示文生成）、OPML の取り込みと書き出し、
マジックリンク認証、フォルダ管理（作成・改名・削除・並べ替え・フィードの移動）、
「要約なし」ビュー、記事本文の保持ポリシー（`purge_article_bodies()`）、
毎朝ダイジェスト自動生成（`/api/cron/digest`）と書き出し履歴の `/exports` 画面、
アーカイブ検索の `/library` 画面（タグ絞り込み込み）、PWA 化、
ダイジェスト完成の Web Push 通知。

未: Google Drive への直接書き出し（OAuth）、
アプリ内の音声生成・スライド再生（P4/P5）、Gemini 使用量の可視化。

## 検証状況

- `npm run build` / `tsc --noEmit` / `eslint --max-warnings 0` / `npm test` すべて通る。
- 未ログイン時の `/`・`/settings` → `/login` の307、cron ルートの401/通過を実機確認済み。
- URL正規化・OPMLの読み書き・Markdown生成は vitest で固定（40件）。
- **実データで確認済み（2026-08-13）**: マイグレーション4本適用、フィード5本・記事178件。
  `poll` → extract → summarize がエラー0件で通り、全記事に要約が付く。
  懸念だった `upsert(..., ignoreDuplicates: true)` + `.select('id')` は白。
  2回目の poll で新規22件だけが extract に積まれ、既存156件は再投入されなかった。
- **毎朝ダイジェストを実データで確認済み（2026-08-13）**。`?dry=1` で選抜だけ見てから
  本番実行し、`exports` 1件・`digests` 1件・`article_states.exported_at` 8件ができた。
  2回目は `already-done` で作らない。未認証は401。`exported_at` による除外も効いており、
  検証で2回作ったときは2本目が別の8件を選んだ（宙に浮いた1本目と、その8件の
  `exported_at` は片付け済み）。
- **Web Push は実機以外を確認済み（2026-08-13）**。VAPID 鍵の受理、本文の暗号化
  （aes128gcm・平文60B→203B）、`Authorization: vapid t=…, k=…` の中身（aud/sub/exp と
  公開鍵の一致）まで通した。`web-push` が本番ビルドで読めることも確認済み
  （jsdom のような ERR_REQUIRE_ESM は出ない。依存は全部 CJS）。
  **残るは実機での配送**で、これは端末の購読が要るので自分で試すしかない。
- `purge_article_bodies()` は実行確認済み。いまは0件（90日を過ぎた既読記事がまだ無い）だが、
  古い既読記事を仕込むと消えることをトランザクション内で確認した。
- **未検証**: スマホ幅のレイアウト（実装はしてある。`/` の先がマジックリンク認証なので
  実機で見るには自分でログインするしかない）、デプロイ後の `supabase/scheduler.sql`
  （pg_cron はまだ入れていない）。
- Vercel にデプロイ済み（https://rsstube.vercel.app ）。本番で `poll` と `jobs/run` が
  動くことを確認済み。**残るは `supabase/scheduler.sql` の実行**（pg_cron 未導入）で、
  それまでは自動巡回が走らない。

## 踏んだ罠

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
- **VAPID 鍵を作り直すと登録済みの端末には二度と届かない。** 購読はブラウザ側で
  公開鍵に紐づくので、鍵を替えたら `push_subscriptions` を空にして端末ごとに
  登録し直すしかない。本番と手元で鍵を揃えること（別々に生成すると、
  手元で登録した端末には本番からの通知が届かない）。

## 次にやること

1. 積んである PR を上から順にマージする（#14 ダイジェスト → #15 PWA →
   #16 アーカイブ → #17 通知。base が数珠つなぎなので順番に）
2. `supabase/scheduler.sql` を本番の Supabase で流す（pg_cron 未導入。
   これを済ませるまで自動巡回も毎朝ダイジェストも走らない）
3. Vercel の環境変数に `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
   `VAPID_SUBJECT` を入れる（値は手元の `.env.local` と同じものを使う）
4. 設定画面を一度保存して `settings` の行を作る（生成時刻・件数・指示文の確定）。
   ついでに通知をオンにして「テスト送信」が届くか見る
5. 翌朝 `/exports` にダイジェストが1本できていることを確認し、
   実際に NotebookLM に入れて音声概要を鳴らす（P2 の本命の受け入れテスト）
6. 鳴らした結果を見て指示文と件数を調整する
7. その後 Drive 連携（OAuth）か P4（自前音声）へ
