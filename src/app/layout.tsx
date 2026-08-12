import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RSSTube',
  description: 'AI要約つきの個人用RSSリーダー',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale は入れない。入力欄をタップしたときの自動ズームを止める目的で
  // よく使われるが、ピンチズームまで殺してしまう（WCAG 1.4.4 違反）。
  // 自動ズームは globals.css で入力欄を16px以上にすることで防いでいる。
  themeColor: '#0b0d10',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
