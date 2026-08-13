import type { MetadataRoute } from 'next';

/**
 * PWA のマニフェスト。Next が /manifest.webmanifest として配信し、
 * <link rel="manifest"> も自動で入れる。
 *
 * スマホのホーム画面から起動して、URLバー無しの単独アプリとして開くのが目的。
 * 朝の通勤前に開くものなので、起動が速く見えることに意味がある。
 *
 * proxy.ts の matcher は manifest.webmanifest を除外してある。
 * ここを認証にかけると、未ログインの状態でインストール要件を満たせなくなる。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RSSTube',
    short_name: 'RSSTube',
    description: 'AI要約つきの個人用RSSリーダー',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: '#0b0d10',
    lang: 'ja',
    // 横向きは禁止しない。タブレットで三ペインを使うことがあるため。
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android は好きな形に切り抜くので、余白を持たせた別画像を渡す。
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
