import { describe, expect, it } from 'vitest';
import { parseFeedDate } from './date';

describe('parseFeedDate', () => {
  it('JST を読める', () => {
    // 千葉県のフィードが実際に返してくる形。JS の new Date() は解釈できない。
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 JST')).toBe('2026-08-26T08:00:00.000Z');
  });

  it('数字のオフセットはそのまま通る', () => {
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 +0900')).toBe('2026-08-26T08:00:00.000Z');
  });

  it('GMT も通る（RFC 822 が名前で認めている）', () => {
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 GMT')).toBe('2026-08-26T17:00:00.000Z');
  });

  it('ISO 8601（dc:date）も通る', () => {
    expect(parseFeedDate('2026-08-26T17:00:00+09:00')).toBe('2026-08-26T08:00:00.000Z');
  });

  it('RFC 822 の北米の略号は JS 側が解釈する（表に入れる必要が無い）', () => {
    // EST / CST / PDT などは new Date() がそのまま読む。表に足すと、
    // JS の解釈と二重になって食い違いのもとになる。
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 EST')).toBe('2026-08-26T22:00:00.000Z');
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 CST')).toBe('2026-08-26T23:00:00.000Z');
  });

  it('表に無い略号は読まない', () => {
    // IST はインド(+0530)/イスラエル(+0200)/アイルランド(+0100) で衝突するので
    // 表に入れていない。間違った時刻を入れるくらいなら日付なしのままにする。
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 IST')).toBeUndefined();
    expect(parseFeedDate('Wed, 26 Aug 2026 17:00:00 XYZ')).toBeUndefined();
  });

  it('読めないものは undefined', () => {
    expect(parseFeedDate('きのう')).toBeUndefined();
    expect(parseFeedDate('')).toBeUndefined();
    expect(parseFeedDate(null)).toBeUndefined();
    expect(parseFeedDate(undefined)).toBeUndefined();
  });

  it('前後の空白があっても読める', () => {
    expect(parseFeedDate('  Wed, 26 Aug 2026 17:00:00 JST  ')).toBe('2026-08-26T08:00:00.000Z');
  });
});
