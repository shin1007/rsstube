'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  BOOT_KEY,
  bootedForThisNavigation,
  formatBootSample,
  parseBootSamples,
} from '@/lib/boot';

/**
 * localStorage を「外の状態」として読む。
 *
 * **`useEffect` で読んで `setState` しないこと**（lint の
 * `react-hooks/set-state-in-effect`）。サーバーには localStorage が無いので、
 * サーバー用の値は null を返す——最初の1枚は「まだ記録がありません」で、
 * 手元の値に差し替わる。食い違わないので hydration は壊れない。
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    removeEventListener('storage', cb);
  };
}

/** 消したときに自分で知らせる。`storage` は**他のタブにしか**飛ばない。 */
function emit() {
  for (const cb of listeners) cb();
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(BOOT_KEY);
  } catch {
    return null;
  }
}

/**
 * 実機で測った起動の内訳を、設定画面に出す。
 *
 * 記録するのは `components/BootTiming.tsx`（`/` に置いてある）。ここは
 * **読むだけ**。localStorage はブラウザごと・端末ごとなので、
 * **iPhone で見た数字は iPhone でしか見えない**（PCで開いても出ない）。
 *
 * 「アイコンを押してから」ではなく「**画面遷移が始まってから**」であることに
 * 注意。アプリの枠が立ち上がるまでの時間はブラウザからは見えないので、
 * ここに出ている合計より実際の体感は長い。
 */
export function BootTimings() {
  const [copied, setCopied] = useState(false);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const samples = useMemo(() => parseBootSamples(raw), [raw]);

  if (samples.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        まだ記録がありません。<strong className="text-zinc-400">この端末で</strong>
        ホーム画面から開き直すと1件増えます（記事一覧が出てから数秒かかります）。
        記録は端末の中だけに残り、サーバーへは送りません。
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(samples.map(formatBootSample).join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // クリップボードが使えない場面（http、権限なし）は黙って諦める。
      // 下の表が出ているので、読み上げてもらえば足りる。
    }
  };

  const clear = () => {
    try {
      localStorage.removeItem(BOOT_KEY);
    } catch {
      // 消せなくても、下の emit() で読み直せば元のまま出る。黙って諦める。
    }
    emit();
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 font-normal">いつ</th>
              <th className="py-1 text-right font-normal">ワーカー</th>
              <th className="py-1 text-right font-normal">転送</th>
              <th className="py-1 text-right font-normal">一覧</th>
              <th className="py-1 text-right font-normal">受け終わり</th>
              <th className="py-1 text-right font-normal">描画</th>
              <th className="py-1 text-right font-normal">完了</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.at} className="border-t border-zinc-900">
                <td className="py-1 text-zinc-400">
                  {new Date(s.at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                  <span className="ml-1 text-zinc-600">{s.standalone ? 'PWA' : 'ブラウザ'}</span>
                </td>
                <td className="py-1 text-right text-zinc-300">
                  {ms(s.swStart)}
                  <span className="ml-1 text-zinc-600">
                    {bootedForThisNavigation(s) === null
                      ? s.swStart === null
                        ? '(通っていない)'
                        : ''
                      : bootedForThisNavigation(s)
                        ? '(起動)'
                        : '(起きていた)'}
                  </span>
                </td>
                <td className="py-1 text-right text-zinc-500">
                  {s.redirects > 0 ? `${s.redirects}本 ${ms(s.redirectEnd)}` : '－'}
                </td>
                <td className="py-1 text-right text-zinc-300">{ms(s.listAt)}</td>
                <td className="py-1 text-right text-zinc-300">{ms(s.responseEnd)}</td>
                <td className="py-1 text-right text-zinc-300">{ms(s.paint)}</td>
                <td className="py-1 text-right text-zinc-200">{ms(s.load)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">
        すべて「画面遷移が始まってから」の時刻です。
        <strong className="text-zinc-500">ワーカー</strong>＝サービスワーカーが起きて通信を始めるまで
        （<strong className="text-zinc-500">(起動)</strong>＝その1回のために起きた＝冷えた状態、
        <strong className="text-zinc-500">(起きていた)</strong>＝起動ぶんは払っていない）。
        <strong className="text-zinc-500">一覧</strong>＝一覧のHTMLが届いた時刻、
        <strong className="text-zinc-500">受け終わり</strong>＝HTMLを最後まで受け取るまで、
        <strong className="text-zinc-500">描画</strong>＝真っ暗が終わるまで、
        <strong className="text-zinc-500">完了</strong>＝操作できるまで。
      </p>

      <p className="text-xs text-zinc-600">
        <strong className="text-zinc-500">一覧が小さいのに描画が遅いなら、遅いのは描くほう。</strong>
        一覧が大きいなら、遅いのはサーバーです。
        アイコンを押してからアプリの枠が立ち上がるまではブラウザから見えないので、
        体感はこの合計より長くなります。
        （この端末の navigationPreload は{samples[0].preload ? 'あり' : 'なし'}）
      </p>

      <p className="text-xs text-zinc-600">
        端末: {samples[0].screen} / コア {samples[0].cores ?? '－'} / HTML{' '}
        {Math.round(samples[0].transfer / 1024)}KB
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="min-h-11 rounded border border-zinc-700 px-3 text-xs text-zinc-300"
        >
          {copied ? 'コピーしました' : '数字をコピー'}
        </button>
        <button
          type="button"
          onClick={clear}
          className="min-h-11 rounded border border-zinc-800 px-3 text-xs text-zinc-500"
        >
          消す
        </button>
      </div>
    </div>
  );
}

function ms(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '－';
  return `${Math.round(n)}ms`;
}
