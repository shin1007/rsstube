'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  view?: View;
  hidden: boolean;
  /** まだ聴いていない音声の数。0 ならバッジを出さない。 */
  unplayed?: number;
}) {
  const pathname = usePathname();
  if (hidden) return null;

  const isMain = pathname === '/';

  const tabs: {
    href: string;
    label: string;
    badge?: number;
    isActive: boolean;
  }[] = [
    { href: '/?view=unread', label: '読む', isActive: isMain && view === 'unread' },
    { href: '/?view=later', label: 'あとで', isActive: isMain && view === 'later' },
    { href: '/?view=starred', label: 'スター', isActive: isMain && view === 'starred' },
    // 朝のダイジェストを取り出すのも、音声を聴くのもスマホからが主。
    { href: '/listen', label: '聴く', badge: unplayed, isActive: pathname.startsWith('/listen') },
    { href: '/exports', label: '書き出し', isActive: pathname.startsWith('/exports') },
    { href: '/settings', label: '設定', isActive: pathname.startsWith('/settings') },
  ];

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-800 bg-zinc-950 select-none no-callout">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          prefetch={true}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          className={`flex min-h-12 flex-1 items-center justify-center text-center text-xs transition touch-manipulation select-none no-callout ${
            tab.isActive
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
