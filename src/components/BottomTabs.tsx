import Link from 'next/link';
import type { View } from '@/lib/types';

/**
 * スマホ用の下部タブ。PCではサイドバーがあるので出さない。
 * 記事を開いている間は本文の邪魔になるので隠す。
 */
export function BottomTabs({
  view,
  hidden,
  unplayed = 0,
}: {
  view: View;
  hidden: boolean;
  /** まだ聴いていない音声の数。0 ならバッジを出さない。 */
  unplayed?: number;
}) {
  if (hidden) return null;

  const tabs: { view?: View; href: string; label: string; badge?: number }[] = [
    { view: 'unread', href: '/?view=unread', label: '読む' },
    { view: 'later', href: '/?view=later', label: 'あとで' },
    { view: 'starred', href: '/?view=starred', label: 'スター' },
    // 朝のダイジェストを取り出すのも、音声を聴くのもスマホからが主。
    { href: '/listen', label: '聴く', badge: unplayed },
    { href: '/exports', label: '書き出し' },
    { href: '/settings', label: '設定' },
  ];

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-800 bg-zinc-950">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          // ホームバーぶんは**リンクの padding** で確保する。nav 側に付けると、
          // その帯は nav の地色で塗られているのにどのリンクにも当たらない
          // ——画面のいちばん下に「タブに見えて押せない」場所ができる。
          //
          // 文字は 48px の枠に入れて上下中央に置き、ホームバーぶんはその下に
          // 残す。文字を上に寄せたままだと、下に何も無い帯ができて
          // 「押せない空白」に見える（当たり判定はあるのに）。
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          className={`flex min-h-12 flex-1 items-center justify-center text-center text-xs transition ${
            tab.view && tab.view === view
              ? 'text-[var(--color-accent-text)] font-semibold border-t-2 border-[var(--color-accent)] -mt-px bg-[var(--color-accent-subtle)]'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {/*
            バッジは字の右上に浮かせる。行の中に並べると、6つのタブが
            1行に収まらなくなって全部が縮む（幅の取り合いは中身の外でやる）。
          */}
          <span className="relative inline-block">
            {tab.label}
            {tab.badge ? (
              <span
                className="absolute -right-2.5 -top-1.5 min-w-[1rem] rounded-full bg-amber-600 px-1 text-[11px] font-medium leading-4 text-zinc-950"
                aria-label={`未視聴 ${tab.badge}件`}
              >
                {tab.badge}
              </span>
            ) : null}
          </span>
        </Link>
      ))}
    </nav>
  );
}
