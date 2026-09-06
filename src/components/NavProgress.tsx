'use client';

import { useLinkStatus } from 'next/link';

/**
 * 押してから画面が変わるまでの帯。
 *
 * **画面遷移だけ、押しても何も起きない時間がある。** ボタン（スター・あとで・
 * 書き出し）はどれも押した瞬間に見た目が変わるのに、タブやフィードを押したときは
 * 250〜380ms のあいだ**押す前の画面のまま**——React の遷移は新しい中身が揃うまで
 * 今の画面を出したままにするので、これは正しい動きだが、押せたのかどうかが
 * 分からない。骨組み（Skeleton）に差し替えてしまうと、いま読んでいるものが
 * 消えるので逆に悪くなる。**上端の帯だけ**にしてあるのはそのため。
 *
 * 出すのは「受け付けた」ことだけで、進み具合は出さない（本当のところが
 * 分からないので、出せば嘘になる）。
 */
export function TopProgress({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div
      aria-hidden
      // 画面のいちばん上。プレイヤー（z-30）やドロワーより手前に出す。
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="nav-progress h-full w-full bg-[var(--color-accent)]" />
    </div>
  );
}

/**
 * `<Link>` の中に置くと、そのリンクが取りに行っているあいだ帯を出す。
 *
 * `useLinkStatus` は **`<Link>` の子孫でしか使えない**（Next 16）。
 * 先読み済みのリンクでは pending にならないので、**先読みが間に合った
 * ときは何も出ない**——それが正しい（出ると、速いのに遅く見える）。
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <TopProgress show={pending} />;
}
