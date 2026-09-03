# RSSTube — AI要約・音声・スライド再生つき個人向けRSSリーダー

## Context

`G:\マイドライブ\ローカルリポジトリ\RSSTube` は空ディレクトリで、完全な新規プロジェクト。

作りたいもの: Inoreader のように大量のフィードを高速に捌けつつ、AI が自動で要約し、深掘りしたい記事は「音声要約」や「スライド付き動画」として再生できる、自分専用の Web アプリ。PC とスマホの両方から使う。

想定する使い方（本人回答）:
- 毎朝ダイジェストを音声で聴く
- 大量の記事を高速にトリアージする
- 気になった記事を個別に深掘り（音声化・スライド化）
- 要約や音声を蓄積して後から検索・振り返る

参考にする良いところ:
- **Inoreader / Feedly** — 三ペインの高速トリアージ、キーボードショートカット、フォルダ、OPML
- **Readless** — 記事単位の短い要点カードで「読むべきか」を即判断
- **Recast / ElevenLabs Reader / Pocket** — 「あとで聴く」キュー、ロック画面操作、再生速度
- **NotebookLM** — 複数ソースをまとめた2話者の対話ポッドキャスト、スライド的な構造化

### 前提の確定事項（調査済み）

**NotebookLM には一般公開 API が存在しない**（2026年8月時点）。Gemini Enterprise 向けの Notebook API はプレビュー提供されているが組織契約が前提で、コンシューマ版 API は「準備中」のまま未提供。単体の Podcast API は deprecated で新規受付停止。

これを受けて本人から「**NotebookLM に放り込んですぐ音声にできる状態を作るだけでも構わない**」との追加方針。よって本プランは次の二段構えにする:

1. **NotebookLM 連携（先に作る・軽い）** — 記事を選んで1クリックで NotebookLM のソースになる形に整形・受け渡しする。音声化は NotebookLM 本体に任せる
2. **自前の音声・スライド生成（後から・任意）** — Gemini API 無料枠で、アプリ内で完結する音声とスライド再生を作る

1 だけでも「毎朝ダイジェストを聴く」「気になった記事を深掘り」は成立する。2 は「アプリを開くだけで自動で音声が溜まっている」「アプリ内で連続再生できる」状態が欲しくなったときに追加する。

自前実装に使う Gemini API 無料枠（公式料金ページで確認）:

| 用途 | モデル | 無料枠 |
|---|---|---|
| 記事要約（大量・安価） | `gemini-3.5-flash-lite` | あり |
| 台本生成・ダイジェスト構成 | `gemini-3.5-flash` | あり |
| 音声合成（最大2話者の対話可） | `gemini-3.1-flash-tts-preview` | あり |

無料枠にはレート制限（RPM/RPD）があるため、**すべての AI 処理をキューテーブル経由の非同期ジョブにして、1回のワーカー実行で処理する件数を絞る**設計にする。有料キーに差し替えれば同じコードのまま上限だけ上がる。

### インフラ上の制約（調査済み）

**Vercel Hobby プランの Cron は「1日1回」まで**（`0 * * * *` のような時間毎の式はデプロイ時にエラー）、かつ実行時刻は±59分ずれる。よって:
- 毎朝ダイジェストの起動 → Vercel Cron（1日1回で十分）
- フィードの定期取得（1時間毎） → **Supabase の `pg_cron` + `pg_net`** から API ルートを叩く（無料枠内、間隔の制約なし）

---

## 技術スタック

- **Next.js 15 (App Router) / TypeScript** — PC/スマホ共通の1コードベース
- **Tailwind CSS + shadcn/ui** — レスポンシブ、PC は三ペイン、スマホは単カラム＋ボトムタブ
- **Supabase** — Postgres / Auth / Storage（音声ファイル）/ `pg_cron`・`pg_net`（スケジューラ）
- **Vercel** — ホスティング、日次 Cron
- **Gemini API** — 要約・台本・TTS
- **PWA** — スマホのホーム画面から起動、Web Push でダイジェスト完成通知

主要ライブラリ: `rss-parser`（フィード解析）、`@mozilla/readability` + `jsdom`（本文抽出）、`@google/genai`（Gemini SDK）、`lamejs`（PCM→MP3、純JSでffmpeg不要）

---

## 設計の要点

### 1. 記事取得パイプライン

```
pg_cron(1時間毎) → /api/cron/poll
  → feeds を巡回 (rss-parser, ETag/Last-Modified で条件付きGET)
  → guid or 正規化URLのハッシュで重複排除 → articles に INSERT
  → jobs テーブルに 'extract' ジョブを積む

worker: /api/jobs/run (pg_cron 5分毎)
  extract   → 記事URLをfetch → Readability で本文抽出 → articles.content_text
              失敗時は RSS の description にフォールバック（フラグを立てて表示で区別）
  summarize → Gemini Flash-Lite で「3行要点 / タグ」を生成
              1リクエストに複数記事をまとめて投げ、無料枠のRPDを節約
```

ジョブは `status`（queued/running/done/failed）+ `attempts` + `next_run_at` を持つ単純な Postgres キュー。`FOR UPDATE SKIP LOCKED` で取得し、1回の実行あたり処理件数に上限を設ける。レート制限エラー（429）は指数バックオフで再キュー。

### 2. NotebookLM 連携 ★ここが最優先

「深掘りしたい記事」に印を付けておくと、**NotebookLM のソースとして即投入できる状態**が自動で用意される。音声概要の生成は NotebookLM 本体に任せるので、こちら側の実装は整形と受け渡しだけで済む。

**受け渡しの3経路**（上から順に手数が少ない）:

1. **Google Drive に書き出す（本命）** — NotebookLM は Google ドライブ上の Google Docs / PDF をソースとして直接選べる。Drive API で `RSSTube/` フォルダに Google Docs を作成しておけば、NotebookLM 側は「ソースを追加 → Google ドライブ → 選ぶ」の2クリックで済む。
   本人はすでに Google Drive を日常利用しているため相性が良い。OAuth（`drive.file` スコープ = 自アプリが作ったファイルのみ）の初回設定が必要。
2. **`.md` としてダウンロード** — スマホ・PC どちらでも動く確実な経路。NotebookLM にファイルをアップロードする。
3. **クリップボードにコピー** — NotebookLM の「コピーしたテキスト」ソースに貼るだけ。最速だが長文だと重い。

**書き出す中身**（1ファイルに複数記事をまとめる。NotebookLM はソース数に上限があるため、1記事1ファイルにはしない）:

```markdown
# RSSTube ダイジェスト 2026-08-11（8件）

## 1. 記事タイトル
- 出典: サイト名 / 著者 / 2026-08-10
- URL: https://...
- AI要点: ・… ・… ・…

（本文全文）

---
## 2. …
```

さらに、**NotebookLM の「音声概要をカスタマイズ」欄に貼るための指示文**も一緒に生成して表示・コピーできるようにする（例:「日本語で、技術的な背景を知らない聴き手向けに、各記事の"何が新しいか"を中心に10分程度で」）。これが音声の出来を大きく左右するので、設定画面でテンプレートとして編集・保存できるようにする。

**導線**:
- 記事ビューの「NotebookLM へ」ボタン → その記事を単体で書き出し
- 一覧のチェックボックスで複数選択 → まとめて書き出し
- 「あとで深掘り」に溜めた記事を、ボタン1つでまとめて書き出し
- 書き出し後、`notebooklm.google.com` を新しいタブで開く。書き出した記事には「NotebookLM 送信済み」の印を付けて二重投入を防ぐ

### 3.（任意・後段）自前の音声化（Recast / ElevenLabs Reader 相当）

記事ビューの「音声化」ボタン → ジョブ投入 → 完成したら「あとで聴く」キューに入る。

```
script  → Gemini Flash で 2話者の対話台本を JSON で生成
          [{speaker:"A"|"B", text, slide_ref}, ...]
tts     → gemini-*-flash-tts-preview のマルチスピーカー合成
          出力は生PCM(L16/24kHz) → WAVヘッダを付与（純JS、ffmpeg不要）
          → lamejs で MP3 化してサイズ削減 → Supabase Storage に保存
```

**重要な設計判断: 音声はセグメント単位で生成・保存する。**
台本を「スライド1枚ぶん」ごとに区切って個別の音声クリップにすることで、
- スライドと音声のタイミングを推定する必要がなくなる（クリップの切れ目＝スライドの切り替わり）
- 長文でも TTS の1リクエストが短く済み、失敗時の再試行が安い
- 途中から再生・スキップが自然にできる

### 4.（任意・後段）スライド再生（NotebookLM + 動画のいいとこ取り）

mp4 は生成しない（本人選択）。台本生成と同時に**スライドJSON**を作り、ブラウザで描画する。

```json
{ "slides": [
  { "type": "title", "title": "...", "subtitle": "..." },
  { "type": "bullets", "heading": "...", "bullets": ["...", "..."] },
  { "type": "quote", "text": "...", "cite": "..." }
] }
```

再生画面 `/watch/[id]` は、スライドを HTML/CSS でレンダリングし、対応する音声セグメントを順に再生してスライドを進める。サーバ負荷ゼロ、スマホでも即再生、シークも軽い。字幕（台本テキスト）も同時表示する。
将来 mp4 が必要になったら、同じスライドJSON＋セグメント音声を材料に外部ワーカーで合成できる（今回の実装がそのまま素材になる）。

### 5. 高速トリアージ UI（Inoreader 相当）

- **PC**: 三ペイン（フォルダ / 記事リスト / 本文）。`j`/`k` 移動、`m` 既読、`s` スター、`v` 元記事、`a` 音声化、`Shift+A` 全既読
- **スマホ**: 単カラム＋ボトムタブ（読む / 聴く / 保存 / 設定）。左右スワイプで既読・あとで
- リストの各行に AI の3行要点を出し、開かずに判断できるようにする

### 6. 毎朝ダイジェスト

```
Vercel Cron (毎日6時台) → /api/cron/digest
  → 過去24hの未読から新しい順にN件を選抜（フィードごとの上限で偏りを防ぐ）
  → まとめ Markdown を生成し、Google Drive に「2026-08-11 ダイジェスト」として保存
  → Web Push で通知（開くと NotebookLM 用の指示文がコピーできる状態）
  → 朝、NotebookLM でそのファイルを選んで音声概要を生成 → 通勤中に聴く
```

自前音声（後段）を実装した場合は、同じ選抜結果から台本→TTS まで自動で走らせ、起床時には `/listen` に音声が用意されている状態にできる。どちらの経路でも**選抜ロジックとまとめ生成は共通**なので、後から差し替えられる。

出典として各トピックに元記事へのリンクを必ず紐づける。

### 7. アーカイブ・検索

要約・台本・本文を Postgres に保持し、`tsvector('simple', ...)` + `pg_trgm` で日本語も引ける全文検索を張る。スター/あとで読む/タグでの絞り込みと組み合わせる。

---

## データモデル（Supabase / Postgres）

| テーブル | 主なカラム |
|---|---|
| `folders` | id, name, sort_order |
| `feeds` | id, folder_id, url, site_url, title, etag, last_modified, last_fetched_at, error_count |
| `articles` | id, feed_id, guid, url, url_hash(unique), title, author, published_at, excerpt, content_text, content_ok |
| `article_states` | article_id, is_read, is_starred, read_later, read_at |
| `summaries` | article_id, bullets(jsonb), tags(text[]), title_ja, model, created_at |
| `exports` | id, kind('manual'\|'digest'), title, markdown, drive_file_id, drive_url, article_ids(uuid[]), created_at |
| `digests` | id, date, export_id, media_id(nullable), article_ids(uuid[]) |
| `jobs` | id, type, payload(jsonb), status, attempts, next_run_at, last_error |
| `settings` | 単一行。NotebookLM用プロンプトのテンプレート、ダイジェスト時刻・件数、要約の言語・長さ、TTS話者/速度 |
| `media` ※後段 | id, kind('article'\|'digest'), article_id, digest_id, status, slides(jsonb), script(jsonb), duration_sec |
| `media_segments` ※後段 | media_id, idx, slide_idx, text, speaker, audio_path, duration_sec |

`article_states` に `exported_at`（NotebookLM 送信済みの印）を持たせて二重投入を防ぐ。
音声（後段）は Supabase Storage の非公開バケットに置き、署名付きURLで配信。RLS は `auth.uid()` ベース（自分専用だが、最初から個人アカウントで閉じる）。

---

## 実装フェーズ

**P0 — 基盤とリーダーとして成立させる**
- `npx create-next-app` で `RSSTube/` に雛形、Supabase プロジェクト作成、マイグレーション整備
- Supabase Auth（自分1アカウント。招待制で新規サインアップは閉じる）
- OPML インポート / フィード手動追加 / フォルダ管理
- `/api/cron/poll` と `pg_cron` 登録、記事一覧UI（PC三ペイン / スマホ単カラム）、既読・スター・あとで
- ✅ ここまでで「AIなしのRSSリーダー」として毎日使える状態

**P1 — AI要約とトリアージ**
- `jobs` キュー + ワーカールート、Gemini クライアントのラッパ（リトライ/バックオフ/使用量記録）
- 本文抽出（Readability）、要約生成、リスト行への要点表示
- キーボードショートカット、スワイプ操作

**P2 — NotebookLM 連携（ここまでで当初の目的は満たせる）**
- まとめ Markdown 生成、クリップボードコピー、`.md` ダウンロード
- Google Drive 連携（OAuth `drive.file` → Google Docs として書き出し → NotebookLM を新規タブで開く）
- NotebookLM 用プロンプトテンプレートの編集・コピー、送信済みマーク
- ✅ 「気になった記事を1クリックで NotebookLM に投げて音声にする」が成立

**P3 — ダイジェストと仕上げ**
- 日次ダイジェスト（Vercel Cron で選抜 → Drive 書き出し）、PWA 化、Web Push 通知
- `/library` 全文検索アーカイブ、使用量ダッシュボード（無料枠の消費状況）

**P4（任意）— 自前音声**
- 台本生成 → セグメント TTS → MP3 化 → Storage 保存
- `/listen` プレイヤー（キュー、連続再生、速度変更、位置の記憶）
- MediaSession API でスマホのロック画面・イヤホン操作に対応

**P5（任意）— スライド再生**
- スライドJSON生成（台本と同時）、`/watch/[id]` の同期再生ビュー、字幕表示
- スライド一覧からのジャンプ、テキストとしてのエクスポート

> P4・P5 は「NotebookLM を毎回手で開くのが面倒」「アプリ内で連続再生したい」と実際に感じてから着手すればよい。P0〜P3 の設計はそのまま素材として使える。

---

## 主要ファイル構成

```
RSSTube/
  app/
    (reader)/page.tsx            記事一覧＋本文（PC三ペイン / スマホ単カラム）
    library/page.tsx             アーカイブ検索
    settings/page.tsx            フィード・OPML・プロンプト設定
    api/cron/poll/route.ts       フィード巡回（pg_cron から）
    api/cron/digest/route.ts     日次ダイジェスト（Vercel Cron から）
    api/jobs/run/route.ts        キューワーカー
    api/export/route.ts          まとめMarkdown生成＋Drive書き出し
    api/auth/google/*            Drive の OAuth コールバック
    listen/page.tsx      ※P4     音声キューとプレイヤー
    watch/[mediaId]/page.tsx ※P5 スライド同期再生
  lib/
    feeds/parse.ts               rss-parser ラッパ、条件付きGET
    feeds/extract.ts             Readability 本文抽出
    ai/gemini.ts                 Gemini クライアント（リトライ・使用量記録）
    ai/summarize.ts              要約（複数記事バッチ）
    export/markdown.ts           記事群 → NotebookLM 用 Markdown
    export/drive.ts              Google Docs として Drive に書き出し
    export/prompt.ts             音声概要カスタマイズ用プロンプト生成
    jobs/queue.ts                enqueue / claim(SKIP LOCKED) / complete
    ai/script.ts         ※P4/P5  対話台本＋スライドJSON生成
    ai/tts.ts            ※P4     マルチスピーカーTTS、PCM→WAV→MP3
  components/
    ArticleList.tsx  ArticleView.tsx  SummaryCard.tsx
    ExportDialog.tsx  BottomTabs.tsx
    Player.tsx ※P4   SlideDeck.tsx ※P5
  supabase/migrations/*.sql
  vercel.json                    日次 cron 定義
```

---

## 検証方法

- **P0**: OPML を実際にインポート → `pg_cron` を待たず `/api/cron/poll` を手動で叩き、記事が入ることを確認。スマホの実機ブラウザで一覧・既読操作を確認
- **P1**: 本文取得できるサイト／できないサイトの両方で要約が出ること、429 が返ったときにジョブが再キューされ後で成功することを確認
- **P2**: 記事を3件選んで書き出し → Drive に Google Docs ができていること → **実際に NotebookLM でそのファイルをソースに選び、音声概要が生成できることを確認**（ここが本命の受け入れテスト）。プロンプトテンプレートを変えて音声の傾向が変わることも確認。スマホからも `.md` ダウンロード経路が動くこと
- **P3**: ダイジェスト生成ルートを手動実行して1本作り、翌朝 Cron で自動生成されていることと Push が届くことを確認
- **P4**: 1記事を音声化し、生成された MP3 を単体再生 → プレイヤーで連続再生 → スマホのロック画面から一時停止・スキップできることを確認
- **P5**: スライドの切り替わりが音声セグメントの切れ目と一致すること、途中スライドへジャンプしても音声が追従することを確認
- 各フェーズ終了時に Gemini の使用量ダッシュボードを見て、無料枠に対する消費ペースを確認する（超えそうなら要約のバッチサイズと TTS の対象件数を絞る）

---

## 未確定・後で決めること

- **NotebookLM 1ファイルあたりの適切な記事数**（多すぎると音声が散漫、少なすぎると手数が増える）。P2 で実際に鳴らして調整する。まずは1ファイル5〜8件で始める
- Google Drive OAuth の設定が思ったより面倒なら、P2 はダウンロード＋コピーだけで出して Drive 連携は後回しにする
- 記事本文が取れないサイトの扱い（諦める / ブラウザ拡張から手動投入する導線を後付けする）
- P4 に進む場合: TTS の話者ボイスの組み合わせ（日本語を数パターン鳴らして選ぶ）、Supabase Storage 無料枠（1GB）の保持期間ポリシー（例: ダイジェスト音声は30日で削除）

## 参考にした一次情報

- [Gemini API pricing（無料枠とモデル別料金）](https://ai.google.dev/gemini-api/docs/pricing)
- [Vercel Cron Jobs の Usage & Pricing（Hobby は1日1回）](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [NotebookLM の API 提供状況](https://discuss.ai.google.dev/t/notebooklm-api/55950)
