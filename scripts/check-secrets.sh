#!/usr/bin/env bash
#
# 追跡対象のファイルに実際の鍵が紛れ込んでいないか調べる。
#
# .env* は .gitignore 済みだが .env.example だけは追跡している（README の
# セットアップ手順が配布を前提にしているため）。ここに実値を書くと
# Public リポジトリにそのまま出る。実際に一度、雛形のつもりで
# Supabase の Secret キーと Gemini の API キーが入りかけた。
#
# git grep は追跡ファイルだけを見るので、.gitignore 済みの .env.local は対象外。

set -uo pipefail

# 「名前:正規表現」。名前に : は使わない。
patterns=(
  "Supabase Secret キー:sb_secret_[A-Za-z0-9_-]{10,}"
  "Supabase Publishable キー:sb_publishable_[A-Za-z0-9_-]{10,}"
  "Supabase パーソナルトークン:sbp_[A-Za-z0-9]{20,}"
  "JWT（旧 anon / service_role キー）:eyJhbGciOi[A-Za-z0-9_-]{10,}"
  "Google API キー:AIza[0-9A-Za-z_-]{35}"
  "Gemini API キー:AQ\.[A-Za-z0-9_-]{20,}"
  "Google OAuth クライアントシークレット:GOCSPX-[A-Za-z0-9_-]{10,}"
  "GitHub トークン:gh[pousr]_[A-Za-z0-9]{20,}"
)

found=0

for entry in "${patterns[@]}"; do
  name="${entry%%:*}"
  regex="${entry#*:}"

  # このスクリプト自身は見本を持っているので除く。
  hits=$(git grep -InE -- "$regex" ':!scripts/check-secrets.sh' || true)

  if [ -n "$hits" ]; then
    # 値そのものは出さない。場所だけ分かればよい。
    echo "見つかりました: $name"
    echo "$hits" | cut -d: -f1,2 | sed 's/^/  /'
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  cat <<'MSG'

追跡対象のファイルに鍵らしき値があります。

  - 鍵は .env.local に置くこと（.gitignore 済み）
  - .env.example は雛形のまま、値は空にしておくこと

既にコミットや push をしてしまった場合、ファイルから消すだけでは履歴に残ります。
その鍵を無効化して発行し直してください。
MSG
  exit 1
fi

echo "追跡ファイルに鍵らしき値はありません。"
