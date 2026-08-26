import { describe, expect, it } from 'vitest';
import { classifyError, MAX_ATTEMPTS, retryAt, shouldRetry } from './retry';

describe('classifyError', () => {
  it('拒まれたものは blocked', () => {
    // Hacker News のリンク先で実際に返ってきたもの（nytimes・medium・wiley）。
    expect(classifyError(new Error('HTTP 403 Forbidden'))).toBe('blocked');
    expect(classifyError(new Error('HTTP 401 Unauthorized'))).toBe('blocked');
  });

  it('消えた記事は notfound', () => {
    expect(classifyError(new Error('HTTP 404 Not Found'))).toBe('notfound');
    expect(classifyError(new Error('HTTP 410 Gone'))).toBe('notfound');
  });

  it('429 と 5xx は相手の一時的な事情なので network', () => {
    // ここを blocked に寄せると、混んでいただけの記事を永久に諦めることになる。
    expect(classifyError(new Error('HTTP 429 Too Many Requests'))).toBe('network');
    expect(classifyError(new Error('HTTP 503 Service Unavailable'))).toBe('network');
  });

  it('HTMLでないものは nonhtml', () => {
    expect(classifyError(new Error('HTMLではない (application/pdf)'))).toBe('nonhtml');
  });

  it('文面が無いものは network 扱い', () => {
    // 時間切れ・DNS・切断。取り直しでいちばん戻るのがここ。
    expect(classifyError(new Error('fetch failed'))).toBe('network');
    expect(classifyError(new Error('The operation was aborted due to timeout'))).toBe('network');
    expect(classifyError('文字列で投げられても落ちない')).toBe('network');
  });
});

describe('shouldRetry', () => {
  it('相手の一時的な事情と、短すぎたものだけ取り直す', () => {
    expect(shouldRetry('network', 1)).toBe(true);
    expect(shouldRetry('short', 1)).toBe(true);
  });

  it('結果が変わらないと分かっているものは取り直さない', () => {
    // 東洋経済(recycled)と Hacker News(blocked) で毎日20件、
    // 何も変わらない取得を繰り返さないための線引き。
    for (const reason of ['blocked', 'notfound', 'nonhtml', 'recycled'] as const) {
      expect(shouldRetry(reason, 1)).toBe(false);
    }
  });

  it('上限に達したら取り直さない', () => {
    expect(shouldRetry('network', MAX_ATTEMPTS)).toBe(false);
    expect(shouldRetry('short', MAX_ATTEMPTS + 1)).toBe(false);
  });
});

describe('retryAt', () => {
  it('6時間後', () => {
    const now = new Date('2026-08-26T09:00:00Z');
    expect(retryAt(now).toISOString()).toBe('2026-08-26T15:00:00.000Z');
  });
});
