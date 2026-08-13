import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import './globals.css';

export const metadata: Metadata = {
  title: 'RSSTube',
  description: 'AI要約つきの個人用RSSリーダー',
  // ホーム画面に追加したときの見た目。iOS は manifest の icons を見ないので
  // apple-touch-icon を別に渡す必要がある。
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'RSSTube',
    // 背景が暗いので、ステータスバーも本文に溶かす。
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale は入れない。入力欄をタップしたときの自動ズームを止める目的で
  // よく使われるが、ピンチズームまで殺してしまう（WCAG 1.4.4 違反）。
  // 自動ズームは globals.css で入力欄を16px以上にすることで防いでいる。
  themeColor: '#0b0d10',
  // ホーム画面から起動したときに、切り欠きの下まで背景を伸ばす。
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
