import type { useRouter } from 'next/navigation';

type Router = ReturnType<typeof useRouter>;

/**
 * 動的なページを**本当に**先読みする。
 *
 * `router.prefetch(href)` の既定は `kind: 'auto'` で、動的ルートでは
 * 「loading.js までの部分」しか取らない。`/` にはその境界が無いので、
 * **要求そのものが1本も飛ばない**（実測: 3秒待っても通信ゼロ。効いているつもりで
 * 何も起きていない、いちばん気づけない形になる）。
 *
 * `'full'` は `<Link prefetch>` と同じ「ページまるごと」。値は Next の
 * `PrefetchKind.FULL`（`next/dist/client/components/router-reducer/router-reducer-types`）で、
 * enum なので外からは文字列で渡すしかない。キャストはそのためだけのもの。
 * Next 側が変わっても、最悪「先読みが効かない（＝今までどおりの速さ）」に戻るだけ。
 */
export function prefetchFull(router: Router, href: string) {
  (router.prefetch as (href: string, options: { kind: string }) => void)(href, { kind: 'full' });
}
