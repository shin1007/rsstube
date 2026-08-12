# RSSTube

AI要約つきの個人用RSSリーダー。大量の記事を素早く捌き、深掘りしたい記事は
NotebookLM に投げてすぐ音声にできる状態まで用意する。

- PC: フォルダ / 記事リスト / 本文 の三ペイン
- スマホ: 単カラム＋下部タブ、左右スワイプで既読・あとで
- 記事は自動で本文を取得し、Gemini で要点3行と重要度スコアを付ける
- 「NotebookLM へ」で複数記事を1つの Markdown にまとめて渡す

## 必要なもの

| | 用途 | 無料枠 |
|---|---|---|
| Supabase | DB / 認証 / スケジューラ | あり |
| Vercel | ホスティング | あり（Hobby） |
| Gemini API | 要約 | あり |

## セットアップ

### 1. Supabase

1. プロジェクトを作る
2. マイグレーションを流す。`.env.local` に `SUPABASE_DB_URL`（ダッシュボード上部の
   「Connect」→ Session pooler の URI）と `SUPABASE_DB_PASSWORD` を入れて
   `npm run db:migrate`。パスワードは記号もそのままでよく、URL 側は
   `[YOUR-PASSWORD]` のままで構わない（スクリプトがエンコードして埋める）。
   ダッシュボードの SQL Editor に手で貼ってもよい（`supabase/migrations/` を番号順に）
3. Authentication > Users で自分のユーザーを1つ作る（メールアドレス）
4. Authentication > Sign In / Providers で **新規サインアップを無効化**する
   （自分専用のため。ログインはマジックリンクのみ）
5. 作ったユーザーの UUID を控える → `OWNER_USER_ID`

### 2. 環境変数

`.env.example` を `.env.local` にコピーして埋める。
`CRON_SECRET` は適当な長いランダム文字列でよい（`openssl rand -hex 32` など）。

キーの名前は Supabase ダッシュボードの Project Settings > API Keys の表記に合わせている。

| ダッシュボードの表記 | 環境変数 | 旧称 |
|---|---|---|
| Publishable key（`sb_publishable_…`） | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon key |
| Secret key（`sb_secret_…`） | `SUPABASE_SECRET_KEY` | service_role key |

`.env` ではなく **`.env.local`** に書くこと。両方あると `.env.local` が優先されるので、
片方を直したつもりでもう片方が効き続ける事故が起きる。

### 3. 起動

```bash
npm install
npm run dev
```

http://localhost:3000 → ログイン → 設定画面から OPML を取り込むかフィードを追加。

### 4. フィード巡回を回す

開発中は手で叩ける:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/run
```

### 5. デプロイ後の定期実行

Vercel にデプロイして URL が決まったら、`supabase/scheduler.sql` の
`__APP_URL__` と `__CRON_SECRET__` を置き換えて Supabase の SQL Editor で流す。

Vercel Hobby の cron は1日1回までなので、1時間毎の巡回と5分毎のワーカーは
Supabase の `pg_cron` 側に持たせている。

## テスト

```bash
npm test          # 1回だけ実行
npm run test:watch
npm run typecheck # next typegen + tsc --noEmit
```

`PageProps` / `LayoutProps` は `next typegen` が生成する global 型なので、
素の `tsc --noEmit` は clone 直後だと落ちる。`npm run typecheck` を使うこと。

PR を作ると GitHub Actions で鍵の混入チェック・型・Lint・テスト・ビルドが回る
（`.github/workflows/ci.yml`）。

```bash
npm run check:secrets
```

`.env.example` は追跡対象なので、ここに実値を書くと Public リポジトリに出る。
`sb_secret_…` や `AQ.…` のような鍵の形を追跡ファイル全体から探して、
見つかれば CI を落とす（`scripts/check-secrets.sh`）。鍵は `.env.local` に置くこと。

外部依存のない純関数だけを対象にしている（URL正規化・OPML の読み書き・
NotebookLM 用 Markdown の生成）。特に URL 正規化は記事の重複判定キーそのものなので、
ここが変わると既読の記事が未読で再登場する。

## バックアップ

```bash
npm run db:backup                                  # backups/<日時>.json に保存
npm run db:restore -- backups/<日時>.json           # 消えた行を埋め戻す
npm run db:restore -- backups/<日時>.json --replace # 全部消してから戻す
```

Supabase の無料プランには自動バックアップも PITR も無い。記事と要約は消えても
巡回し直せばよいが、購読一覧・フォルダ構成・スター・あとで・書き出し履歴は
作り直しが効かないので、たまに走らせておくこと。

スキーマは `supabase/migrations/` が git にあるので取らない。落とすのはデータだけで、
戻すときは先に `npm run db:migrate` を済ませておく。`jobs` は巡回のたびに作られる
一時的なキューなので対象外（戻すと古い仕事が動き出す）。

`backups/` は `.gitignore` 済み。購読内容が入るので追跡してはいけない。10世代まで保持する。

## 仕組み

```
pg_cron(1時間毎) → /api/cron/poll
    フィード巡回（ETag/Last-Modified で条件付きGET）→ articles に追加
    → jobs に extract を積む

pg_cron(5分毎) → /api/jobs/run
    extract   記事URLを取得して Readability で本文抽出
              失敗したら RSS の抜粋にフォールバック（画面上で区別表示）
    summarize 複数記事を1リクエストにまとめて Gemini へ
              → 要点3行 / タグ / 重要度スコア(0-100)
```

無料枠のレート制限に当たらないよう、1回の実行で処理する件数を絞ってある。
429 が返ったジョブは指数バックオフで再キューされる（`fail_job`）。

## キーボードショートカット（PC）

| キー | 動作 |
|---|---|
| `j` / `k` | 次 / 前の記事 |
| `o` / `Enter` | 開く |
| `m` | 既読・未読を切り替え |
| `s` | スター |
| `l` | あとで |
| `v` | 元記事を新しいタブで開く |
| `Shift+A` | 表示中をすべて既読 |

購読一覧は設定画面の「書き出す」から OPML で保存できる（`/api/opml`）。

## 未実装

- Google Drive への書き出し（現状は `.md` ダウンロードとクリップボードコピー）
- 毎朝ダイジェストの自動生成
- PWA / Web Push
- アプリ内での音声生成・スライド再生（Gemini TTS を使う後段フェーズ）
