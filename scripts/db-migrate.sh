#!/usr/bin/env bash
#
# supabase/migrations/ の SQL を番号順にリモートDBへ流す。
#
# supabase db push を使わないのは、あちらが <timestamp>_name.sql という
# 命名を前提にしていて、こちらの 0001_ / 0002_ 形式と噛み合わないため。
# ファイル数が少ないので db query で素直に順番に流す。
#
# 各ファイルは create ... if not exists / create or replace で書いてあるので
# 二度流しても壊れない。0001 の create table だけは二度目に落ちる（そのときは
# 「もう入っている」ということなので、エラーを読んで判断すること）。

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/db-env.sh
. scripts/db-env.sh

failed=0

for f in supabase/migrations/*.sql; do
  [ -e "$f" ] || continue
  echo "── $f"
  if npx --yes supabase db query --db-url "$SUPABASE_DB_URL" -f "$f"; then
    echo "   OK"
  else
    echo "   失敗: $f" >&2
    failed=1
    break   # 順番に依存しているので、落ちたらそこで止める
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "途中で止まりました。上のエラーを読んでから直して流し直してください。" >&2
  exit 1
fi

echo ""
echo "マイグレーションを流し終えました。"
