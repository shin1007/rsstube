#!/usr/bin/env bash
#
# リモートDBのバックアップ。
#
# Supabase の無料プランには自動バックアップも PITR も無い（Pro から）。
# 記事と要約は消えても巡回し直せばよいが、フィードの購読一覧・フォルダ構成・
# スター・あとで・NotebookLM への書き出し履歴は作り直しが効かない。
#
# schema と data を別ファイルに分けるのは Supabase の推奨どおり。
# 戻すときは schema → data の順に流す。
#
# 出力先の backups/ は .gitignore 済み。個人の購読内容が入るので
# Public リポジトリに入れてはいけない。

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/db-env.sh
. scripts/db-env.sh

STAMP=$(date +%Y%m%d-%H%M%S)
DIR="backups"
mkdir -p "$DIR"

SCHEMA="$DIR/$STAMP-schema.sql"
DATA="$DIR/$STAMP-data.sql"

echo "── スキーマ"
if ! npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$SCHEMA"; then
  echo "スキーマのダンプに失敗しました。" >&2
  exit 1
fi

echo "── データ"
# --use-copy は行数が多いときに速く、復元も速い。
if ! npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy -f "$DATA"; then
  echo "データのダンプに失敗しました。" >&2
  exit 1
fi

echo ""
echo "保存しました:"
for f in "$SCHEMA" "$DATA"; do
  # Windows の Git Bash でも動くようにサイズは wc で取る。
  printf '  %s (%s バイト)\n' "$f" "$(wc -c < "$f" | tr -d ' ')"
done

# 古いものを増やし続けても意味が無いので、新しい方から10世代だけ残す。
KEEP=10
old=$(ls -1t "$DIR"/*-schema.sql 2>/dev/null | tail -n +$((KEEP + 1)))
if [ -n "$old" ]; then
  echo ""
  echo "古い世代を削除:"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    d="${s%-schema.sql}-data.sql"
    echo "  ${s##*/}"
    rm -f "$s" "$d"
  done <<< "$old"
fi
