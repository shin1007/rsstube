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
- **未検証**: スマホ幅のレイアウト、`purge_article_bodies()` の実行、
  デプロイ後の `supabase/scheduler.sql`（pg_cron はまだ入れていない）。

## 次にやること

1. Supabase プロジェクトを作り `supabase/migrations/` の3本を流す
2. `.env.local` を実値に差し替え、自分のユーザーを1つ作って `OWNER_USER_ID` に入れる
3. OPML を取り込み `/api/cron/poll` を手で叩いて記事が入ることを確認
4. `GEMINI_API_KEY` を入れて `/api/jobs/run` を叩き、要約が付くことを確認
5. その後 Drive 連携か毎朝ダイジェストへ
