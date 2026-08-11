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
2. SQL Editor で `supabase/migrations/0001_init.sql` → `0002_jobs_rpc.sql` の順に流す
3. Authentication > Users で自分のユーザーを1つ作る（メールアドレス）
4. Authentication > Sign In / Providers で **新規サインアップを無効化**する
   （自分専用のため。ログインはマジックリンクのみ）
5. 作ったユーザーの UUID を控える → `OWNER_USER_ID`

### 2. 環境変数

`.env.example` を `.env.local` にコピーして埋める。
`CRON_SECRET` は適当な長いランダム文字列でよい（`openssl rand -hex 32` など）。

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

## 未実装

- Google Drive への書き出し（現状は `.md` ダウンロードとクリップボードコピー）
- 毎朝ダイジェストの自動生成
- PWA / Web Push
- アプリ内での音声生成・スライド再生（Gemini TTS を使う後段フェーズ）
