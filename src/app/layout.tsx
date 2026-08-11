import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RSSTube',
  description: 'AI要約つきの個人用RSSリーダー',
};

export const viewport: Viewport = {
  // スマホで入力欄をタップしたときに勝手にズームされないようにする。
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0b0d10',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
