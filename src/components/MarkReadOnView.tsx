'use client';

import { markRead } from '@/app/actions/articles';
import { useEffect, useRef, useTransition } from 'react';

/**
 * 表示された記事を既読にする。
 *
 * 一覧で押して開いたものは ArticleList の open が既読にするが、**最初から
 * 選ばれている記事**はどこも通らないので未読のまま残っていた。PCで一覧を開いた
 * ときの先頭記事と、`?article=` 付きのURLを開き直したときの両方が当てはまる。
 *
 * 気をつけることが2つある。
 *
 * 1. **スマホでは記事ペインが `hidden md:block` で消えているだけ**で、DOM には
 *    居る。素直に effect で既読にすると、一覧を眺めているだけの人の先頭記事が
 *    黙って既読になる。実際に見えているかどうかは IntersectionObserver に聞く
 *    （`display:none` は交差しないので、これだけで両方を見分けられる）。
 *
 * 2. **最初に見た1件だけを既読にする。** markRead は revalidate するので、
 *    未読ビューでは既読にした記事が一覧から消え、先頭が次の記事にずれる。
 *    ずれた先も既読にすると、**未読が端から連鎖して消えていく**。
 *    あとから開いたぶんは open が面倒を見るので、ここは初回だけでよい。
 */
export function MarkReadOnView({
  articleId,
  isRead,
}: {
  articleId: string;
  isRead: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [, startTransition] = useTransition();
  /** 最初に受け取った記事。ずれた先を追いかけないための錨。 */
  const anchorId = useRef(articleId);
  const marked = useRef(false);

  useEffect(() => {
    if (isRead || marked.current) return;
    if (articleId !== anchorId.current) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (marked.current) return;
      marked.current = true;
      observer.disconnect();
      // 結果は見ない。既読が付かなくても読むことはできるので、
      // ここで失敗を知らせても邪魔になるだけ。
      startTransition(() => void markRead(articleId, true));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [articleId, isRead]);

  return <span ref={ref} aria-hidden className="block h-px w-px" />;
}
