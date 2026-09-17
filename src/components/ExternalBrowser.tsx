'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * iPhone のホーム画面から起動したときに、外へのリンクをブラウザ本体で開く。
 *
 * **ホーム画面のアプリ（standalone）で `target="_blank"` を押すと、iOS は
 * アプリの上に簡易ブラウザを重ねる。** そこではブラウザのログイン状態も
 * 広告ブロックも使えず、閉じると読んでいたページも消える。Web 側から
 * 「既定のブラウザで開け」と頼む手段は無いので、ブラウザごとの URL スキームに
 * 書き替えて渡す。
 *
 * - Safari は `x-safari-https://`（iOS 17 以降）
 * - Brave は `brave://open-url?url=`
 * - Chrome は `googlechromes://`
 *
 * **既定のブラウザは Web から読めない**ので、どれに渡すかは設定で選ぶ。
 * 入っていないブラウザを選ぶと iOS が「アドレスが無効」を出すだけで何も開かない。
 * 端末ごとに入っているブラウザが違うので、TextScale と同じく localStorage に持つ。
 *
 * iPhone の standalone 以外（Safari のタブ・PC・Android）では何もしない。
 * そこでは `target="_blank"` がもう普通のタブで開くため。
 */

export const EXTERNAL_BROWSER_KEY = 'rsstube:external-browser';

type Choice = 'inapp' | 'safari' | 'brave' | 'chrome';

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'brave', label: 'Brave' },
  { value: 'safari', label: 'Safari' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'inapp', label: 'アプリ内' },
];

/** オーナーの iPhone の既定が Brave なので、選んでいなければ Brave に渡す。 */
const DEFAULT_CHOICE: Choice = 'brave';

function read(): Choice {
  try {
    const raw = localStorage.getItem(EXTERNAL_BROWSER_KEY);
    return CHOICES.some((c) => c.value === raw) ? (raw as Choice) : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** iOS だけが持つ `navigator.standalone`。ホーム画面から起動したときだけ true。 */
function isIosStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function browserUrl(url: string, choice: Choice): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const rest = parsed.href.slice(parsed.protocol.length); // "//host/path"
  switch (choice) {
    case 'safari':
      return `x-safari-${parsed.protocol}${rest}`;
    case 'brave':
      return `brave://open-url?url=${encodeURIComponent(parsed.href)}`;
    case 'chrome':
      return `${parsed.protocol === 'https:' ? 'googlechromes' : 'googlechrome'}:${rest}`;
    case 'inapp':
      return null;
  }
}

/** layout に置く。何も描かない。 */
export function ExternalLinkHandler() {
  useEffect(() => {
    if (!isIosStandalone()) return;

    // 捕捉ではなく浮上で聞く。React の onClick（document より内側の root に付く）が
    // 先に走り、そこで preventDefault したリンクには手を出さない。
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[target="_blank"]');
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = browserUrl(a.href, read());
      if (!to) return;
      e.preventDefault();
      location.href = to;
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(value: Choice) {
  try {
    localStorage.setItem(EXTERNAL_BROWSER_KEY, value);
  } catch {
    // 覚えられなければ既定のまま。
  }
  for (const l of listeners) l();
}

/** 設定画面の選択肢。 */
export function ExternalBrowserPicker() {
  const current = useSyncExternalStore(subscribe, read, () => DEFAULT_CHOICE);
  const standalone = useSyncExternalStore(subscribe, isIosStandalone, () => true);

  return (
    <div>
      <div className="flex gap-2" role="group" aria-label="リンクを開くブラウザ">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={current === c.value}
            onClick={() => save(c.value)}
            className={`bar-button flex-1 rounded border px-3 ${
              current === c.value
                ? 'border-sky-600 bg-sky-950/40 text-zinc-100'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        iPhone のホーム画面から開いたときに、元記事などのリンクをどのブラウザで開くか。
        <strong className="font-semibold text-zinc-400">この端末だけ</strong>
        の設定です。入っていないブラウザを選ぶと何も開きません。
        {!standalone && ' いまはホーム画面のアプリではないので、この設定は効きません。'}
      </p>
    </div>
  );
}
