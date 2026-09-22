import type { MetadataRoute } from 'next';

/**
 * PWA のマニフェスト。Next が /manifest.webmanifest として配信し、
 * <link rel="manifest"> も自動で入れる。
 *
 * スマホのホーム画面から起動して、URLバー無しの単独アプリとして開くのが目的。
 * 朝の通勤前に開くものなので、起動が速く見えることに意味がある。
 *
 * **ここに認証を掛けないこと。** 未ログインの状態でインストール要件を
 * 満たせなくなる（sw.js と offline.html も同じ理由で素通し。lib/auth/guard.ts は
 * ページ側で呼ぶ形なので、public/ と静的な口はもともと通らない）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RSSTube',
    short_name: 'RSSTube',
    description: 'AI要約つきの個人用RSSリーダー',
    /**
     * **アイコンから開く先は `/` ではなく `/start.html`。**
     *
     * `/` は毎回サーバーで組む画面で、実機では応答を受け終わるまで 0.8〜2.2秒
     * あり、WebKit はそれまで**何も描かない**（docs/traps/perf.md）。
     * `/start.html` はサービスワーカーのキャッシュから即返る静的な1枚で、
     * 出たら自分で `/` へ移る。移っているあいだブラウザはこの枠を出したままに
     * するので、**待ち時間が真っ暗にならない**（速くなるわけではない）。
     *
     * **通知から開く先は今までどおり `/exports` など。** start_url は
     * 「アイコンを押したとき」にしか効かないので、他の入口は素通りする。
     */
    start_url: '/start.html',
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
