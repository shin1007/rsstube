/**
 * **ホーム画面から開いた1回**を、実機の中で記録するための形。
 *
 * サーバー側の待ち時間は 3029ms → 246ms まで落ちたのに、iPhone SE では
 * まだ3秒かかっている（2026-09-08）。ここから先はサーバーからは見えない:
 * サービスワーカーの起動、PWA そのものの起動、ハイドレーション。
 * **どれも実機でしか出ない**ので、端末に測らせて持ち帰る。
 *
 * 置き場は localStorage（`components/BootTiming.tsx` が書き、
 * `components/BootTimings.tsx` が設定画面で出す）。**サーバーへは送らない**
 * ——1人しか使っていないアプリで、そのために口を1つ増やす必要が無い。
 */

/** 1回ぶんの記録。ミリ秒はすべて「画面遷移が始まった時刻」からの相対。 */
export type BootSample = {
  /** 記録した時刻（表示用の絶対時刻）。 */
  at: number;
  /** どのページか。`/` 以外も混ざると比べられないので出す。 */
  path: string;
  /** ホーム画面から開いたか（`display-mode: standalone`）。ブラウザのタブなら false。 */
  standalone: boolean;
  /** `navigate` / `reload` / `back_forward`。**冷えた起動は `navigate` だけ**。 */
  type: string;

  /**
   * **サービスワーカーの起動ぶん。** ワーカーが画面遷移の取得を始めた時刻から、
   * 画面遷移が始まった時刻を引いたもの（`public/sw.js` の `LAST_NAV`）。
   * WebKit は `workerStart` を埋めてくれないので、こちらで測る。
   * ワーカーが起きていなければ null。
   */
  swStart: number | null;
  /** ワーカー自身が起きた時刻（同じ原点）。`swStart` との差が小さいなら、この遷移のために起きた。 */
  swBoot: number | null;
  /** navigationPreload が使えるか。**iPhone では false になるはず**（WebKit 未対応）。 */
  preload: boolean;

  /** リダイレクトの本数と、そこに使った時間。トークンが生きていれば 0。 */
  redirects: number;
  redirectEnd: number;
  /** 最初の1バイトが返ってきた時刻。ここまでがサーバーの番。 */
  responseStart: number;
  /** HTML を受け取り終えた時刻。`responseStart` との差が、流し込みにかかった時間。 */
  responseEnd: number;
  /** HTML の大きさ（圧縮後 / 展開後）。先頭記事の当たり外れで5倍変わる。 */
  transfer: number;
  decoded: number;

  /** 最初に何かが描かれた時刻。**「真っ暗が終わる」のはここ**。 */
  paint: number | null;
  /** ハイドレーションが済んだあたり。`responseEnd` との差が端末の重さ。 */
  interactive: number;
  load: number;

  /** 端末の見分け。SE の第1世代は 320x568、第2・第3世代は 375x667。 */
  screen: string;
  cores: number | null;
  /** 回線（Safari には無いので null になる）。 */
  net: string | null;
};

/** localStorage の鍵。形を変えたら版を上げる（古いものは読み捨てる）。 */
export const BOOT_KEY = 'rsstube-boot-v1';

/** 残す件数。数回ぶん見比べられれば足りる。 */
export const BOOT_KEEP = 12;

/** 文字列から起こす。壊れていても画面は出す——測るためのものが画面を壊さないこと。 */
export function parseBootSamples(raw: string | null): BootSample[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BootSample[]) : [];
  } catch {
    return [];
  }
}

/** 読み出し。localStorage はプライベートブラウズや容量切れで普通に落ちる。 */
export function readBootSamples(): BootSample[] {
  try {
    return parseBootSamples(localStorage.getItem(BOOT_KEY));
  } catch {
    return [];
  }
}

/**
 * **その遷移のためにワーカーが起きたのか、もう起きていたのか。**
 *
 * ここを取り違えると読み違える。`swStart`（通信を始めた時刻）が小さくても、
 * ワーカーが**前から起きていた**なら起動ぶんは払っていない——ホーム画面から
 * 久しぶりに開く朝とは別の状態を見ていることになる。
 * `swBoot` が負なら、この画面遷移より前から起きていた。
 */
export function bootedForThisNavigation(s: BootSample): boolean | null {
  if (s.swBoot === null) return null;
  return s.swBoot > -50;
}

/**
 * 1回ぶんを人が読める数行にする。**そのまま貼って渡せること**が目的。
 *
 * 画面で表を眺めるより、これを送ってもらうほうが早い。
 */
export function formatBootSample(s: BootSample): string {
  const ms = (n: number | null) => (n === null ? '－' : `${Math.round(n)}ms`);
  const when = new Date(s.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return [
    `${when} ${s.path} ${s.standalone ? 'PWA' : 'ブラウザ'} ${s.type}`,
    `  ワーカー ${ms(s.swStart)}（${
      bootedForThisNavigation(s) === null
        ? '効いていない'
        : bootedForThisNavigation(s)
          ? 'この遷移のために起きた'
          : '前から起きていた'
    }／preload ${s.preload ? 'あり' : 'なし'}）`,
    `  リダイレクト ${s.redirects}本 ${ms(s.redirectEnd)} → 応答 ${ms(s.responseStart)} → 受け終わり ${ms(s.responseEnd)}`,
    `  描画 ${ms(s.paint)} → 操作可 ${ms(s.interactive)} → 完了 ${ms(s.load)}`,
    `  HTML ${Math.round(s.transfer / 1024)}KB（展開後 ${Math.round(s.decoded / 1024)}KB）`,
    `  画面 ${s.screen} / コア ${s.cores ?? '－'} / 回線 ${s.net ?? '－'}`,
  ].join('\n');
}
