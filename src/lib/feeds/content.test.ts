import { describe, expect, it } from 'vitest';
import { contentHash, normalizeContent, usableAsFallback } from './content';

const long = (s: string) => s.repeat(Math.ceil(120 / s.length));

describe('normalizeContent', () => {
  it('空白の詰め方を揃える', () => {
    // 取得のたびに改行やインデントが揺れるので、そこで差が出ないようにする。
    expect(normalizeContent('  本文  が\n\n続く \t ')).toBe('本文 が 続く');
  });
});

describe('contentHash', () => {
  it('同じ本文は同じハッシュ', () => {
    const a = long('アクセスが集中しています。しばらく時間をおいてお試しください。');
    expect(contentHash(a)).toBe(contentHash(a));
  });

  it('空白の詰まり方が違っても同じとみなす', () => {
    // 取得のたびに改行やインデントは揺れる。そこで別物にならないことを見る
    // （空白そのものが増減すれば別の文字列になるのは正しい）。
    const a = `${'記事の本文です。'.repeat(20)}\n\n続き`;
    const b = a.replace(/\n\n/g, '  \t  ');
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('本文が違えば別のハッシュ', () => {
    // 本物の記事どうしは一致しない。ここが誤検出しない根拠。
    expect(contentHash(long('記事Aの本文。'))).not.toBe(contentHash(long('記事Bの本文。')));
  });

  it('書き出しが同じなら、後ろが違っても同じとみなす', () => {
    // ナビゲーションを掴んでいる記事はこの形になる。末尾に記事ごとの違いが
    // 少し混じるだけで全文一致は外れるので、書き出しだけを見る。
    const nav = '有料会員登録 お知らせ ビジネス 政治・経済・投資 キャリア・教育 ライフ'.repeat(6);
    expect(contentHash(`${nav} 記事Aの見出し`)).toBe(contentHash(`${nav} 記事Bの見出し`));
  });

  it('書き出しが違えば、後ろが同じでも別とみなす', () => {
    // 同じフッターで終わる記事どうしを巻き添えにしない。
    const footer = 'この記事のフッターです。'.repeat(10);
    expect(contentHash(`記事Aの書き出し。${'本文。'.repeat(40)}${footer}`)).not.toBe(
      contentHash(`記事Bの書き出し。${'本文。'.repeat(40)}${footer}`),
    );
  });

  it('短すぎるものはハッシュを作らない', () => {
    // 100字未満は抽出失敗として扱うので、比べる意味が無い。
    expect(contentHash('短い')).toBeNull();
    expect(contentHash('')).toBeNull();
  });

  it('ちょうど100字なら作る', () => {
    expect(contentHash('あ'.repeat(100))).not.toBeNull();
    expect(contentHash('あ'.repeat(99))).toBeNull();
  });
});

describe('usableAsFallback', () => {
  it('Hacker News の「Comments」だけの説明文は使わない', () => {
    // HN は全記事の description が Comments へのリンク1つ。これを本文として
    // 保存すると、一覧にも要約にも「Comments」が並ぶ。
    expect(usableAsFallback('Comments')).toBe(false);
  });

  it('短い実要約は残す', () => {
    // 東洋経済の RSS が実際に持っている51字の要約。ここを捨ててはいけない。
    expect(
      usableAsFallback(
        'ソフトバンクグループが､半導体大手TSMCの保有株を突如72%も大幅削減したことが明らかになりました。',
      ),
    ).toBe(true);
  });

  it('空白だけのものは使わない', () => {
    expect(usableAsFallback('   \n\n   ')).toBe(false);
  });
});
