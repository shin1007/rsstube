import Link from 'next/link';
import type { View } from '@/lib/types';

/**
 * スマホ用の下部タブ。PCではサイドバーがあるので出さない。
 * 記事を開いている間は本文の邪魔になるので隠す。
 */
export function BottomTabs({ view, hidden }: { view: View; hidden: boolean }) {
  if (hidden) return null;

  const tabs: { view?: View; href: string; label: string }[] = [
    { view: 'unread', href: '/?view=unread', label: '読む' },
    { view: 'later', href: '/?view=later', label: 'あとで' },
    { view: 'starred', href: '/?view=starred', label: 'スター' },
    // 朝のダイジェストを取り出すのも、音声を聴くのもスマホからが主。
    { href: '/listen', label: '聴く' },
    { href: '/exports', label: '書き出し' },
    { href: '/settings', label: '設定' },
  ];

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-800 bg-zinc-950"
      // iPhone のホームバーに隠れないように下側の安全領域を確保する。
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          className={`flex-1 py-3 text-center text-xs ${
            tab.view && tab.view === view ? 'text-zinc-100' : 'text-zinc-500'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
