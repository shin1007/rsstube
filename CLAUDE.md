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
「要約なし」ビュー、記事本文の保持ポリシー（`purge_article_bodies()`）。

未: Google Drive への直接書き出し（OAuth）、毎朝ダイジェスト自動生成、PWA/Web Push、
アプリ内の音声生成・スライド再生、全文検索の `/library` 画面。

## 検証状況

- `npm run build` / `tsc --noEmit` / `eslint --max-warnings 0` / `npm test` すべて通る。
- 未ログイン時の `/`・`/settings` → `/login` の307、cron ルートの401/通過を実機確認済み。
- URL正規化・OPMLの読み書き・Markdown生成は vitest で固定（40件）。
- **実データで確認済み（2026-08-13）**: マイグレーション4本適用、フィード5本・記事178件。
  `poll` → extract → summarize がエラー0件で通り、全記事に要約が付く。
  懸念だった `upsert(..., ignoreDuplicates: true)` + `.select('id')` は白。
  2回目の poll で新規22件だけが extract に積まれ、既存156件は再投入されなかった。
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

## 次にやること

1. Supabase プロジェクトを作り `supabase/migrations/` の3本を流す
2. `.env.local` を実値に差し替え、自分のユーザーを1つ作って `OWNER_USER_ID` に入れる
3. OPML を取り込み `/api/cron/poll` を手で叩いて記事が入ることを確認
4. `GEMINI_API_KEY` を入れて `/api/jobs/run` を叩き、要約が付くことを確認
5. その後 Drive 連携か毎朝ダイジェストへ
