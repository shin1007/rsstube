import { describe, expect, it } from 'vitest';
import { pdfTextToParagraphs } from '@/lib/feeds/pdf';

/**
 * PDFの改行は「紙の行の終わり」であって文の切れ目ではない。
 * そのまま出すと一文が何行にも割れ、日本語では単語の途中で切れて見える。
 */
describe('pdfTextToParagraphs', () => {
  it('折り返された日本語の行を、詰めてつなぐ', () => {
    const text = ['厚生労働省では、毎月、歯科医療費の動向等を迅速に把握するため、電算処理分の', 'レセプトを集計しています。'].join(
      '\n',
    );

    expect(pdfTextToParagraphs(text)).toEqual([
      '厚生労働省では、毎月、歯科医療費の動向等を迅速に把握するため、電算処理分のレセプトを集計しています。',
    ]);
  });

  it('欧文は空白を入れてつなぐ', () => {
    expect(pdfTextToParagraphs('How Organizations\nUse AI')).toEqual(['How Organizations Use AI']);
  });

  it('文末で段落を切る（PDFには段落の空行がほとんど無い）', () => {
    const text = '一つ目の文です。\n二つ目の文が\n続きます。';

    expect(pdfTextToParagraphs(text)).toEqual(['一つ目の文です。', '二つ目の文が続きます。']);
  });

  it('空行も段落の区切りとして扱う', () => {
    expect(pdfTextToParagraphs('見出し\n\n本文の一行目')).toEqual(['見出し', '本文の一行目']);
  });

  it('空白だけの行は落とす', () => {
    expect(pdfTextToParagraphs('  \n\n   \n')).toEqual([]);
  });
});
