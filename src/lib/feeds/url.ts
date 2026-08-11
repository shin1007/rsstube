import { createHash } from 'node:crypto';

/**
 * 記事URLの正規化と重複判定キー。
 *
 * 同じ記事が複数のフィードから流れてきたり、同じフィードでもURLに
 * 計測用パラメータが付いたり付かなかったりして別記事に見えることがある。
 * 表示用のURLは元のまま残しつつ、重複判定だけは正規化した形で行う。
 */

// 記事の同一性に関係しない計測パラメータ。
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ref$/i,
  /^ref_src$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^spm$/i,
  /^__twitter_impression$/i,
];

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());

    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';

    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.searchParams.sort();

    // 末尾スラッシュの有無で割れるのを防ぐ（ルートは除く）。
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    // URLとして壊れていても、文字列そのままでキーにはできる。
    return raw.trim();
  }
}

export function urlHash(raw: string): string {
  return createHash('sha256').update(normalizeUrl(raw)).digest('hex');
}
