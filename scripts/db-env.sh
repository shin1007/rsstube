#!/usr/bin/env bash
#
# .env.local から接続文字列だけを取り出す共通部分。
#
# .env.local を丸ごと source しない。値に空白や # が混じっていると
# そこで解釈が壊れて、後ろの変数が黙って空になる（実際に一度やらかした）。
# 必要な1行だけを取り出す。

set -uo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE がありません。" >&2
  exit 1
fi

# 値に = が含まれていても壊れないよう、最初の = より後ろを全部取る。
SUPABASE_DB_URL=$(grep -m1 '^SUPABASE_DB_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/')

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  # 案内文に接続文字列の実例は書かない。check-secrets.sh がパスワード入りの
  # 接続文字列を探すので、見本を置くと自分で引っかかる。
  cat >&2 <<'MSG'
SUPABASE_DB_URL が .env.local にありません。

  Supabase ダッシュボード > Project Settings > Database > Connection string > URI
  （Session pooler か Direct connection。Transaction pooler の 6543 番は
   DDL に使えないことがあるので避ける）

そこに出る postgresql:// で始まる1行をまるごと SUPABASE_DB_URL= の右に貼る。
パスワードに記号が入る場合はパーセントエンコードすること（@ は %40 など）。
MSG
  exit 1
fi

export SUPABASE_DB_URL
