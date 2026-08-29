'use client';

import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useSyncExternalStore } from 'react';

/**
 * 「このブラウザはパスキーを扱えるか」。
 *
 * `useEffect` + `setState` で書くと、描画のあとにもう一度描き直すことになる
 * （React の lint がこれを止める）。値は一度決まったら変わらないので、
 * 購読しない外部ストアとして読む。
 *
 * サーバー側では `window` が無くて判定できないので `'unknown'` を返す。
 * **最初の描画では必ず `'unknown'`** になるので、その間は「非対応」と
 * 言い切らないこと（対応している端末に「非対応」が一瞬出る）。
 */

const NO_SUBSCRIBE = () => () => {};

export function usePasskeySupport(): 'unknown' | 'yes' | 'no' {
  return useSyncExternalStore(
    NO_SUBSCRIBE,
    () => (browserSupportsWebAuthn() ? 'yes' : 'no'),
    () => 'unknown',
  );
}
