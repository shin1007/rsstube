'use client';

import { markRead } from '@/app/actions/articles';
import { alreadyMarkedRead, rememberRead } from '@/lib/read-marks';
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
 * 2. **同じ記事を二度書かない。**送った id は read-marks が覚えている。
 *    以前は「最初に見た1件だけ」に絞っていた——revalidate 付きで書いていたので、
 *    未読ビューでは既読にした記事が一覧から消えて先頭が次へずれ、ずれた先も
 *    既読にすると**未読が端から連鎖して消えていった**。書き直さなくなった今は
 *    一覧がずれないので、その錨は要らない。**「次の記事」で読み進めたぶんも
 *    ここで既読になる**（錨があった頃は、押して進んだ記事が未読のまま残っていた）。
 *
 * 書き込みは quiet（`/` を描き直さない）。ここを revalidate にすると、
 * **先読みしておいた次の記事のぶんまで一緒に捨てられる**ので、「次の記事」で
 * 読み進めるたびに待ち時間が戻ってくる。一覧の行には read-marks 経由で出る。
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

  useEffect(() => {
    if (isRead) return;
    // 一覧から開いたものは open が既にこの id を送っている。**サーバーの
    // 読み取りが書き込みに勝つと isRead はまだ false で返る**ので、これだけでは
    // 見分けられず、記事を開くたびに2通目が飛んでいた。送った id を覚えて止める。
    if (alreadyMarkedRead(articleId)) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (alreadyMarkedRead(articleId)) return;
      rememberRead(articleId);
      observer.disconnect();
      // 結果は見ない。既読が付かなくても読むことはできるので、
      // ここで失敗を知らせても邪魔になるだけ。
      startTransition(() => void markRead(articleId, true, true));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [articleId, isRead]);

  return <span ref={ref} aria-hidden className="block h-px w-px" />;
}
