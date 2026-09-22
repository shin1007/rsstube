/**
 * iOS の**起動画面**（apple-touch-startup-image）の一覧。
 *
 * ホーム画面から開いてから最初の描画までのあいだ、iOS は**真っ暗な画面**を出す
 * （manifest の `background_color` がそのまま出ているだけで、Android のように
 * アイコンを重ねてはくれない）。実機の記録では最初の描画まで 0.8〜2.2秒あり、
 * そのあいだ「押したのに何も起きていない」ようにしか見えない
 * （docs/traps/perf.md の実機の内訳）。**起動そのものを速くする話とは別に**、
 * 待っているあいだに何か出しておく必要がある。
 *
 * iOS は**寸法が完全に一致する `media` の1枚しか使わない**。幅・高さ・画素密度・
 * 向きのどれかが違うと、その端末では**今までどおり真っ暗**になる（悪化はしない）。
 * なので端末ごとに1枚ずつ要る。`npm run icons` が `public/splash/` に書き出し、
 * `app/layout.tsx` がここから `<link>` を並べる。**片方だけ足さないこと。**
 *
 * 縦向きだけにしてある。朝ホーム画面から開くのは必ず縦で、横向きのぶんまで
 * 用意すると枚数が倍になる（出ないときは真っ暗に戻るだけ）。
 *
 * 端末を買い替えたら、ここに1行足して `npm run icons` → 生成物ごとコミットする。
 * 幅と高さは Safari で `screen.width` / `screen.height` を見れば分かる。
 */
export type SplashDevice = {
  /** CSS ピクセルの幅（`screen.width`）。 */
  w: number;
  /** CSS ピクセルの高さ（`screen.height`）。 */
  h: number;
  /** 画素密度（`devicePixelRatio`）。 */
  ratio: number;
  /** どの端末のぶんか。生成物の名前には使わない（寸法が同じ端末があるため）。 */
  label: string;
};

export const SPLASH_DEVICES: SplashDevice[] = [
  { w: 320, h: 568, ratio: 2, label: 'iPhone SE(第1世代)' },
  // オーナーの端末。ここが基準（docs/traps/perf.md の実機の内訳）。
  { w: 375, h: 667, ratio: 2, label: 'iPhone SE(第2/第3世代), 8' },
  { w: 414, h: 736, ratio: 3, label: 'iPhone 8 Plus' },
  { w: 375, h: 812, ratio: 3, label: 'iPhone X, XS, 11 Pro, 12 mini, 13 mini' },
  { w: 414, h: 896, ratio: 2, label: 'iPhone XR, 11' },
  { w: 414, h: 896, ratio: 3, label: 'iPhone XS Max, 11 Pro Max' },
  { w: 390, h: 844, ratio: 3, label: 'iPhone 12, 13, 14' },
  { w: 428, h: 926, ratio: 3, label: 'iPhone 12/13 Pro Max, 14 Plus' },
  { w: 393, h: 852, ratio: 3, label: 'iPhone 14 Pro, 15, 16' },
  { w: 430, h: 932, ratio: 3, label: 'iPhone 14 Pro Max, 15 Pro Max, 16 Plus' },
  { w: 402, h: 874, ratio: 3, label: 'iPhone 16 Pro' },
  { w: 440, h: 956, ratio: 3, label: 'iPhone 16 Pro Max' },
];

/** 実際に書き出す画素の寸法。 */
export function splashPixels(d: SplashDevice): { w: number; h: number } {
  return { w: d.w * d.ratio, h: d.h * d.ratio };
}

/** 生成物の場所。`public/` 起点。 */
export function splashHref(d: SplashDevice): string {
  const px = splashPixels(d);
  return `/splash/${px.w}x${px.h}.png`;
}

/**
 * `<link media="...">` の中身。
 *
 * **4つとも書くこと。** どれかを省くと、条件を満たす別の端末が同じ画像を
 * 掴んで引き伸ばされる。
 */
export function splashMedia(d: SplashDevice): string {
  return (
    `(device-width: ${d.w}px) and (device-height: ${d.h}px) and ` +
    `(-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)`
  );
}
