import type { NextConfig } from "next";

/**
 * Cache Components（Next 16）を有効にしてある。
 *
 * 狙いは**押した瞬間に枠が出ること**。それまでは全ページが
 * `dynamic = 'force-dynamic'` で、押してからサーバーがページを丸ごと組み終える
 * まで何も出なかった（本番の実測で250〜380ms。うち120msは Vercel が
 * middleware を1回起こすぶんで、こちらでは動かせない）。
 *
 * Cache Components では「静的な枠＋セッションぶんのキャッシュ」を先に配り、
 * 残りを `<Suspense>` の中に流し込む。ログインが要るアプリでも
 * `"use cache: private"` が使える——結果は**ブラウザの中だけ**に置かれ、
 * サーバーには残らない（`docs/traps/perf.md`）。
 *
 * `partialPrefetching` は、リンク1本ごとではなく**ルートごとに1つの App Shell**を
 * 先読みする。サイドバーからは同じ `/` へのリンクが十数本出ているので、
 * ここが効く（今までは見えているリンクのぶんだけ先読みが飛んでいた）。
 */
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
