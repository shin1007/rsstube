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

毎朝ダイジェストも同じように叩ける。`dry=1` は何も書かずに選抜結果だけ返すので、
「今日の8件」がどう選ばれるかを確かめてから本番で作れる:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" 'http://localhost:3000/api/cron/digest?dry=1'
curl -H "Authorization: Bearer $CRON_SECRET" 'http://localhost:3000/api/cron/digest?force=1'
```

`force=1` は生成時刻を待たずに作るが、その日のぶんが既にあれば作らない。
書き出した記事には `exported_at` が付いて選抜から外れるため、作り直しのつもりで
叩くと中身の違う2本目ができてしまう。本当に作り直すときは `digests` の当日行を
消してから叩くこと。

### 5. デプロイ後の定期実行

Vercel にデプロイして URL が決まったら、`supabase/scheduler.sql` の
`__APP_URL__` と `__CRON_SECRET__` を置き換えて Supabase の SQL Editor で流す。

Vercel Hobby の cron は1日1回までなので、1時間毎の巡回と5分毎のワーカーは
Supabase の `pg_cron` 側に持たせている。毎朝ダイジェストも同様で、Vercel Cron は
実行時刻が±59分ずれる（6時のダイジェストが7時前にできる）ため pg_cron に寄せた。

## アーカイブ検索（/library）

一覧が「これから読むもの」を捌く場所なのに対して、`/library` は「前に読んだあれ」を
掘り返す場所。既読も込みで全部を対象に、タグ・スター・書き出し済み・期間で絞れる。
絞り込みは全部 URL に載るので、よく使う組み合わせはブックマークできる。

検索は既定でタイトルだけを見る。タイトルには trgm 索引が効くので速い。
「本文も探す」を入れると本文まで見るが、こちらは索引が無いので順スキャンになる
（本文に trgm 索引を張ると索引だけで数百MBになり得て、無料枠の500MBと釣り合わない。
本文は保持期間を過ぎると消えるので、古い記事はもともとタイトルでしか引けない）。

`simple` 辞書の tsvector 索引は日本語だと語境界が取れず実質使えないので、
検索には使っていない。

## PWA

スマホのホーム画面に追加すると、URLバー無しの単独アプリとして起動する。
マニフェストは `src/app/manifest.ts`、サービスワーカーは `public/sw.js`。

サービスワーカーは**ほとんど何もキャッシュしない**。記事一覧も本文もログイン済みの
動的なページで、既読・スターの状態が刻々と変わるので、HTML や API の応答を握ると
「昨日の未読一覧」を見せる事故になる。やるのは圏外での画面遷移に `offline.html` を
出すことと、Web Push の受け口だけ。開発中は登録しない（Turbopack の差し替えと
噛み合わず、直したものが出てこない原因になる）。

アイコンは画像ライブラリを足さずに生成している:

```bash
npm run icons   # public/icon-*.png を作り直す
```

生成物は git に入れてある。ビルドのたびに作る必要が無いのと、手元に無いと
本番でアイコンだけ欠けるため。図柄や色を変えるときは `scripts/make-icons.mjs` を直す。

## AI の使用量

設定画面に直近7日の呼び出し回数とトークンが出る。無料枠の上限はモデルごとの
1日あたり回数（RPD）で決まるので、フィードを増やしたらここが伸びていないか見る。
**失敗が並んでいるときは上限に当たっている可能性が高い**（429 でジョブがバックオフし、
要約が静かに遅れる）。

記録は日×モデルの集計（`ai_usage`）。呼び出しごとに行を作ると掃除が要るため。
日付の区切りは日本時間なので、Google 側のリセット（太平洋時間）とは半日ほどずれる。
失敗した呼び出しも RPD を1回ぶん食うので、`failures` として別に数えている。

## 通知（Web Push）

朝のダイジェストができたときに端末へ通知する。アプリを開いていなくても届くので、
これが「起きたら聴く」の起点になる。

```bash
npm run vapid   # VAPID 鍵を作る。出た3行を .env.local に貼る
```

本番では Vercel の環境変数にも同じ3つ（`NEXT_PUBLIC_VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`）を入れる。**鍵を作り直すと、登録済みの端末には
二度と届かなくなる**（購読が公開鍵に紐づくため）。作り直したときは
`push_subscriptions` を空にして、端末ごとに登録し直すこと。

設定画面の「通知をオンにする」で端末を登録する。**端末ごとに1回ずつ要る**。
登録できたら「テスト送信」で確かめられる（通知は届かないことが分かりにくいので、
朝を待たずに試せるようにしてある）。

iPhone / iPad は、Safari のタブで開いている間は通知を登録できない。
共有メニューから「ホーム画面に追加」して、**そこから開いたときだけ**購読できる。

使えなくなった購読先（ブラウザの再インストールや通知の拒否）は、送信時に 404/410 が
返った時点で自動的に消える。放っておくと毎朝失敗し続けるため。

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

pg_cron(1時間毎) → /api/cron/digest
    設定した時刻（日本時間）の回だけ、過去24時間の未読から重要度上位を選抜
    → NotebookLM 用の Markdown を1本作って /exports に置く
```

ダイジェストの選抜はフォルダごとに上限（全体の1/3）を設けてあり、当たりの多い
フォルダだけで埋まらないようにしている。それでも枠が余ったら上限を外して重要度順に埋める。

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
