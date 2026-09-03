'use client';

import { useSyncExternalStore } from 'react';

/**
 * 文字の大きさを、読む人が選べるようにする。
 *
 * これまでは目盛り（`@theme`）をこちらで動かしていて、直すたびに全体が動いた
 * （`docs/traps/ui.md` にあるとおり3回やり直している）。**大きさの好みは
 * 人と端末で違う**ので、決めるのは読む人のほうが早い。
 *
 * **端末ごとに覚える（localStorage）。** サーバーに持たないのは、スマホと PC で
 * ちょうどよい大きさが違うため——同じ設定を共有すると、片方が必ず不便になる。
 * DBの列を1つ増やさずに済むのも都合がよい。
 *
 * 実際に当てるのは `--text-scale` ひとつ。`globals.css` がその値で
 * `--text-*` を計算し直すので、クラスは1つも書き替えなくてよい。
 * **最初の描画で当てるのは layout.tsx の小さなスクリプト**——ここでやると、
 * 一瞬だけ元の大きさで出てから切り替わる。
 */

export const TEXT_SCALE_KEY = 'rsstube:text-scale';

/** 幅は控えめに。1.3倍にすると帯のボタンが1行に収まらなくなる。 */
const STEPS: { value: number; label: string }[] = [
  { value: 0.9, label: '小' },
  { value: 1, label: '中' },
  { value: 1.15, label: '大' },
];

function read(): number {
  try {
    const raw = Number(localStorage.getItem(TEXT_SCALE_KEY));
    return STEPS.some((s) => s.value === raw) ? raw : 1;
  } catch {
    // プライベートウィンドウなどで localStorage が使えないことがある。
    return 1;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(value: number) {
  document.documentElement.style.setProperty('--text-scale', String(value));
  try {
    localStorage.setItem(TEXT_SCALE_KEY, String(value));
  } catch {
    // 覚えられなくても、この画面を開いている間は効く。
  }
  for (const l of listeners) l();
}

export function TextScale() {
  // サーバーでは分からないので 1 を返す（usePasskeySupport と同じ書き方）。
  const current = useSyncExternalStore(subscribe, read, () => 1);

  return (
    <div>
      <div className="flex gap-2" role="group" aria-label="文字の大きさ">
        {STEPS.map((step) => (
          <button
            key={step.value}
            type="button"
            aria-pressed={current === step.value}
            onClick={() => apply(step.value)}
            className={`bar-button flex-1 rounded border px-3 ${
              current === step.value
                ? 'border-sky-600 bg-sky-950/40 text-zinc-100'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'
            }`}
            // 見本を兼ねる。押す前に、その大きさがどう見えるか分かる。
            style={{ fontSize: `calc(${step.value} * var(--text-base))` }}
          >
            {step.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        押すとすぐ変わります。<strong className="font-semibold text-zinc-400">この端末だけ</strong>
        の設定です——スマホと PC でちょうどよい大きさは違うので、揃えていません。
      </p>
    </div>
  );
}
