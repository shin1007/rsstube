import type { Metadata, Viewport } from 'next';
import { PlaybackProvider } from '@/components/Playback';
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
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{" +
              "var s=localStorage.getItem('rsstube:text-scale');" +
              "if(s==='0.9'||s==='1'||s==='1.15')document.documentElement.style.setProperty('--text-scale',s);" +
              "var c=localStorage.getItem('rsstube:theme-color');" +
              "if(c)document.documentElement.setAttribute('data-accent',c);" +
              "}catch(e){}",
          }}
        />
      </head>
      {/*
        高さは `min-h-full` ではなく `h-dvh` で**確定**させる。

        min-height は下限を決めるだけなので、中身が伸びれば body も伸びる。
        すると子の `h-full`（= height:100%）や `flex-1 overflow-y-auto` が
        寄りかかる先が無くなり、**各画面の内側スクロールが一つも効かない**。
        実測では一覧が body 10753px まで伸び、サイドバー下端の「設定」が
        y=10721 —— 画面の1万px下にあった。

        ここを 100dvh に変えるだけで 848px に収まり、設定は y=816 に来る。
        親の `flex-1` に高さを足しても直らない（flex-basis が height に勝つため）。
        dvh なのはスマホのアドレスバー伸縮に追随させるため。

        overflow-hidden は body 自体をスクロールさせないため。各画面は
        自分の `overflow-y-auto` でスクロールする。新しい画面を足すときは
        **ルート要素に overflow-y-auto を付けること**（付けないと溢れが切れる）。
      */}
      <body className="h-dvh overflow-hidden flex flex-col bg-zinc-950 text-zinc-100">

        {/*
          下部プレイヤーは**ここ**に置く。

          聴くページの中に置いていたので、一覧へ戻った時点で消えて音も止まっていた。
          ルートの layout に居れば、ページを移っても React が作り直さないので、
          鳴らしたまま記事を読みに行ける。<audio> ごと生き残るのも大事で、
          作り直すとブラウザが「操作で起こした要素」ではなくなって鳴らせなくなる。
        */}
        <PlaybackProvider>{children}</PlaybackProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
