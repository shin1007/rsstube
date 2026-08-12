#!/usr/bin/env bash
#
# .env.local から接続文字列を組み立てる共通部分。
#
# .env.local を丸ごと source しない。値に空白や # が混じっていると
# そこで解釈が壊れて、後ろの変数が黙って空になる（実際に一度やらかした）。
# 必要な行だけを取り出す。
#
# パスワードは SUPABASE_DB_PASSWORD に生のまま置ける。ダッシュボードの URI は
# パスワード部分が [YOUR-PASSWORD] のままなので、そこに手で埋める際に
# 記号のパーセントエンコードを忘れて認証だけ失敗する、というのが起きやすい。
# 生のまま受け取ってこちらでエンコードする。

set -uo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE がありません。" >&2
  exit 1
fi

# 値に = が含まれていても壊れないよう、最初の = より後ろを全部取る。
read_env() {
  grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/'
}

SUPABASE_DB_URL=$(read_env SUPABASE_DB_URL)
SUPABASE_DB_PASSWORD=$(read_env SUPABASE_DB_PASSWORD)

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  # 案内文に接続文字列の実例は書かない。check-secrets.sh がパスワード入りの
  # 接続文字列を探すので、見本を置くと自分で引っかかる。
  cat >&2 <<'MSG'
SUPABASE_DB_URL が .env.local にありません。

  ダッシュボード上部の「Connect」ボタン > Session pooler
  （Transaction pooler の 6543 番は DDL に使えないことがあるので避ける）

そこに出る postgresql:// で始まる1行をまるごと SUPABASE_DB_URL= の右に貼る。
パスワード部分は [YOUR-PASSWORD] のままでよい。実際のパスワードは別行に

  SUPABASE_DB_PASSWORD=（記号もそのまま、エンコード不要）

と書けば、こちらで URL に埋め込む。
MSG
  exit 1
fi

# パスワードを別に貰っているなら、URL の該当部分を差し替える。
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  # 予約文字をパーセントエンコードする。パスワードは ASCII 前提。
  encoded=""
  for (( i = 0; i < ${#SUPABASE_DB_PASSWORD}; i++ )); do
    ch="${SUPABASE_DB_PASSWORD:i:1}"
    case "$ch" in
      [a-zA-Z0-9.~_-]) encoded+="$ch" ;;
      *) encoded+=$(printf '%%%02X' "'$ch") ;;
    esac
  done

  # scheme://user:<ここ>@host... の <ここ> だけを置き換える。
  # ホスト以降に @ は現れないので、最後の @ ではなく最初の @ までを見る。
  if [[ "$SUPABASE_DB_URL" =~ ^([a-zA-Z]+://[^:/@]+):[^@]*@(.*)$ ]]; then
    SUPABASE_DB_URL="${BASH_REMATCH[1]}:${encoded}@${BASH_REMATCH[2]}"
  elif [[ "$SUPABASE_DB_URL" =~ ^([a-zA-Z]+://[^:/@]+)@(.*)$ ]]; then
    # パスワードが書かれていない形。
    SUPABASE_DB_URL="${BASH_REMATCH[1]}:${encoded}@${BASH_REMATCH[2]}"
  else
    # ここでも URL の見本は書かない（check-secrets.sh に引っかかるため）。
    echo "SUPABASE_DB_URL の形が読めません。ダッシュボードの Connect が出す" >&2
    echo "postgresql:// で始まる1行をそのまま貼り直してください。" >&2
    exit 1
  fi
fi

# 埋めていない雛形のまま実行しようとしていないか。
case "$SUPABASE_DB_URL" in
  *'[YOUR-PASSWORD]'*|*'%5BYOUR-PASSWORD%5D'*)
    echo "SUPABASE_DB_URL のパスワードが [YOUR-PASSWORD] のままです。" >&2
    echo "SUPABASE_DB_PASSWORD に実際のパスワードを書くか、URL に直接埋めてください。" >&2
    exit 1
    ;;
esac

export SUPABASE_DB_URL
