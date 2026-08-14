@AGENTS.md

# RSSTube — プロジェクトの前提

AI要約つきの個人用RSSリーダー。詳細な設計は `docs/plan.md`、
セットアップ手順は `README.md` を見ること。

## 決まっていること（蒸し返さない）

- **NotebookLM に公開APIは無い**（2026年8月時点。Enterprise版のみ、コンシューマ版は未提供）。
  なので「アプリで整形 → 人が NotebookLM に投入」が P2 の方針。自前音声は後段（P4、実装済み）。
  2026-07 に「Gemini Notebook」へ改称し、Video Overview / Slide Deck / Infographic なども
  出せるようになったが、**API が無いことは変わっていない**ので自動化の対象にはならない。
  出来上がりは向こうが上なので、書き出しの経路は残し続ける。
  音声・スライドの他サービスの比較は `docs/tts-options.md`。結論は「いまは変えない、
  Gemini TTS の preview が終わったら Google Cloud TTS」。
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
  各ユーザーの `settings.digest_hour`（日本時間）を**過ぎていて**当日ぶんがまだ
  無ければ作る。「ちょうどその時刻か」で見ないのは、pg_net の失敗やデプロイ中の
  1回で cron が落ちただけでその日のダイジェストが永久に作られなくなるため
  （次の実行はもう別の時刻になる）。過ぎていれば作る形なら自分で追いつく。
  cron の式は1つしか置けないので、ユーザーごとの時刻を式では表せない。
  Vercel Cron を使わないのは1日1回制限に加えて実行時刻が±59分ずれるから
  （6時のダイジェストが7時前にできてしまう）。
- **ダイジェストを作り直すのは「digests の当日行を消してから」**。
  書き出した記事には `exported_at` が付いて選抜から外れるので、`force=1` を
  もう一度叩いても同じものは再現せず、中身の違う2本目ができて1本目が宙に浮く。
  なので `force=1` は生成時刻だけを無視し、当日ぶんの有無は必ず見る。
- **自前音声はセグメント（クリップ）単位で作って保存する**。台本をスライド1枚ぶんに
  区切り、長ければさらに700字ごとに割る。切れ目がそのままスライドの切り替わりに
  なるので、再生側は時刻からスライドを逆算しなくてよい。TTS の1回も短く済み、
  失敗時の再試行が安い。`media_segments` が `idx` と `slide_idx` を別に持つのは、
  1スライドが複数セグメントに割れるため（モデルがスライドを1枚しか返さないことがある）。
- **mp4 は作らない**。スライドは HTML/CSS で描く（plan.md §4）。サーバー側の合成が
  要らず、スマホでも即出る。将来 mp4 が要るなら、同じスライドJSONと
  セグメント音声がそのまま素材になる。
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

Gemini 使用量の記録と表示（`ai_usage`・設定画面）。これで P3 は一通り済んだ。
さらに P4/P5 の自前音声とスライド再生（台本生成・セグメントTTS・MP3化・
Storage保存・`/listen`・`/watch/[id]`）。

未: Google Drive への直接書き出し（OAuth）。

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
- **使用量の記録は実データで確認済み（2026-08-13）**。`/api/jobs/run` を叩いて
  要約2バッチを走らせ、`ai_usage` に呼び出し=2・入力12932・出力1556トークンが
  記録された（`SUMMARIZE_BATCHES_PER_RUN=2` × `BATCH_SIZE=5` = 10件の要約と一致）。
- **自前音声を実データで確認済み（2026-08-14）**。TTS は `audio/l16 24kHz mono`
  （生PCMで48KB/秒）を返す。64kbps の MP3 にして約6分の1、実測 473KB/分＝
  10分で4.6MB、Storage 1GB に約220本。台本生成→セグメント分割→合成→MP3→
  Storage→署名URL→非公開の確認まで通した。本番ビルドでも合成できる
  （`@breezystack/lamejs` は依存ゼロの純ESMで、jsdom のような問題は出ない）。
  **未確認: 実際に耳で聴いた品質**（音が入っていることは波形のRMSで確認済み）、
  複数スライドでの台本生成の再現（無料枠を使い切ったため。1度は35発話の
  自然な対話が出ている）、`/listen`・`/watch` の画面表示（ログインが要る）。
- `purge_article_bodies()` は実行確認済み。いまは0件（90日を過ぎた既読記事がまだ無い）だが、
  古い既読記事を仕込むと消えることをトランザクション内で確認した。
- **未検証**: スマホ幅のレイアウトと PWA のインストール（実装はしてある。`/` の先が
  マジックリンク認証なので実機で見るには自分でログインするしかない）、
  Web Push の実機配送、生成した音声を耳で聴いた品質。
- **本番は自動で回っている（2026-08-14 から）**。Vercel（https://rsstube.vercel.app ）と
  Supabase は**手元と同じプロジェクトを見ている**。`.env.local` の向き先＝本番なので、
  `npm run db:migrate` はそのまま本番に当たる（別環境ではない。取り違えないこと）。
  - `supabase/scheduler.sql` 適用済み。`cron.job` に5本（poll / worker / digest /
    purge / media-purge）が active で入っている。
  - pg_net → Vercel の経路も確認済み（`net._http_response` に 200 が返る）。
    Vercel の `CRON_SECRET` は手元の `.env.local` と同じ値に揃えてある。
    **片方だけ変えると pg_cron からの呼び出しが全部 401 になる。**
  - VAPID 3つも Vercel に入れてある（手元と同じ値。ここがズレると
    手元で登録した端末に本番からの通知が届かない）。
  - `settings` の行も作成済み（生成時刻6時・8件・本文90日・音声30日）。

## 踏んだ罠

- **`res.text()` は日本語のサイトで文字化けする。** Content-Type に charset が無いと
  UTF-8 として読むが、自治体・省庁には Shift_JIS / EUC-JP が現役で残っていて、
  charset を meta にだけ書いていることがある（例: `mhlw.go.jp`）。
  厄介なのは**化けても長さはあるので抽出は「成功」に見える**こと。化けた文字列が
  そのまま要約に回る。`lib/feeds/charset.ts` で Content-Type → BOM → meta の順に見る。
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
- **`responseSchema` に `maxItems` を入れると 400 になることがある。** 項目3つの
  オブジェクトでは通り、7つにすると `INVALID_ARGUMENT` で弾かれた。理由は本文に
  出ないので原因不明の400として返ってくる。件数の上限はプロンプトと
  受け取り側の切り詰めで担保すること（`lib/ai/script.ts`）。
- **`maxOutputTokens` は思考トークンも含む。** 3.5-flash は答える前に考えるので、
  8192 にしたら思考だけで使い切って本文が716字で切れた。絞るときは
  `thinkingBudget` も一緒に指定する。`finishReason === 'MAX_TOKENS'` を見て
  「打ち切られた」と分かるようにしてある（見ないと JSON の parse エラーとして
  出てきて原因が分からない）。
- **`gemini-3.5-flash` の無料枠は1日20リクエスト。** 台本生成1本で1回使う。
  デバッグで何度も叩くとその日ぶんが尽きる（実際に尽くした）。
  使用量は設定画面の表で見られる。要約の flash-lite とは別枠。
  **無料枠と上限の全体は `docs/quotas.md` にまとめてある。**公開情報だと
  Flash 系は500〜1500 RPD と書かれていることが多いが、手元のキーは20だった。
  外の数字ではなく `ai_usage` と 429 の本文（`limit:` が書いてある）を見ること。
- **1回のワーカー実行は時間で切る。** 件数だけで絞っても、TTS は1セグメントに
  数十秒かかることがあり `maxDuration = 60` を超えると関数ごと落ちて、
  running のジョブが宙に浮く。`TIME_BUDGET_MS` を見ながら次の種類に進む前に
  切り上げる形にしてある。
- **VAPID 鍵を作り直すと登録済みの端末には二度と届かない。** 購読はブラウザ側で
  公開鍵に紐づくので、鍵を替えたら `push_subscriptions` を空にして端末ごとに
  登録し直すしかない。本番と手元で鍵を揃えること（別々に生成すると、
  手元で登録した端末には本番からの通知が届かない）。

## 次にやること

**オーナー本人にしかできないことは `docs/owner-todo.md` にまとめてある。**
実機での確認・決めごと・認証情報が要るものはそちら。以下はその要約。

コードは P0〜P5 まで main に入り、**本番も自動で回り始めた**（2026-08-14）。
残っているのは**自分の目と耳でしか確かめられないこと**と、Drive 連携だけ。

### 自分でしか確かめられないこと

1. 通知をオンにして「テスト送信」が届くか（iOS はホーム画面に追加してから）。
   鍵は本番にも入れてあるので、あとは端末を登録するだけ
2. スマホ幅のレイアウトと、ホーム画面への追加（PWA）
3. **生成した音声を実際に聴いて品質を判断する**。声は
   `GEMINI_TTS_VOICE_A` / `_B` で差し替えられる
4. NotebookLM にダイジェストを入れて音声概要を鳴らす（P2 の本命の受け入れテスト）。
   出来上がりは向こうのほうが上なので、自前音声と聴き比べてどちらを主にするか決める

### 積み残しの検証

5. 複数スライドでの台本生成の再現（`gemini-3.5-flash` の枠が1日20回で、
   調査に使い切った日があった。枠が戻ってから `/exports` の
   「アプリ内で音声にする」で1本作る）

### 未実装

6. Google Drive への直接書き出し（OAuth）。plan.md の P2 で唯一残っているもの。
   Google Cloud Console でクライアントを作るところから始まる
   （`drive.file` スコープ）。「面倒なら後回しでよい」と最初から書いてある項目

### しばらく見ておくとよいもの

- 設定画面の使用量表。18本のフィードを1時間毎に巡回するようになったので、
  要約の呼び出しが1日どれくらいになるか（`docs/quotas.md`）
- `select * from cron.job_run_details order by start_time desc limit 20;`
  で pg_cron が失敗していないか
