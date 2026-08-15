import { describe, expect, it } from 'vitest';
import { buildMarkdown, safeFileName, type ExportArticle } from './markdown';

const article = (over: Partial<ExportArticle> = {}): ExportArticle => ({
  title: '記事タイトル',
  url: 'https://example.com/a',
  feedTitle: 'サイト名',
  author: '著者',
  publishedAt: '2026-08-10T00:00:00Z',
  bullets: ['要点1', '要点2', '要点3'],
  contentText: '本文です。',
  contentOk: true,
  ...over,
});

describe('buildMarkdown', () => {
  it('見出しに件数を出す', () => {
    const md = buildMarkdown([article(), article()], 'RSSTube ダイジェスト');
    expect(md.startsWith('# RSSTube ダイジェスト（2件）')).toBe(true);
  });

  it('記事に連番を振る', () => {
    const md = buildMarkdown([article({ title: '1本目' }), article({ title: '2本目' })], 'T');
    expect(md).toContain('## 1. 1本目');
    expect(md).toContain('## 2. 2本目');
  });

  it('出典・URL・AI要点を並べる', () => {
    const md = buildMarkdown([article()], 'T');
    expect(md).toContain('- 出典: サイト名 / 著者 / ');
    expect(md).toContain('- URL: https://example.com/a');
    expect(md).toContain('- AI要点:');
    expect(md).toContain('  - 要点1');
  });

  it('出典が全部無ければ出典行を出さない', () => {
    const md = buildMarkdown([article({ feedTitle: null, author: null, publishedAt: null })], 'T');
    expect(md).not.toContain('- 出典:');
    expect(md).toContain('- URL:');
  });

  it('要約が無ければAI要点行を出さない', () => {
    expect(buildMarkdown([article({ bullets: null })], 'T')).not.toContain('- AI要点:');
    expect(buildMarkdown([article({ bullets: [] })], 'T')).not.toContain('- AI要点:');
  });

  it('本文が取れていない記事には注記を付ける', () => {
    // NotebookLM が抜粋を全文と誤解して話を膨らませるのを抑えるための行。
    const md = buildMarkdown([article({ contentOk: false })], 'T');
    expect(md).toContain('- 注記: 本文を取得できず、RSSの抜粋のみ');
  });

  it('本文が取れていれば注記は出ない', () => {
    expect(buildMarkdown([article()], 'T')).not.toContain('- 注記:');
  });

  it('長すぎる本文を2万字で切る', () => {
    const md = buildMarkdown([article({ contentText: 'あ'.repeat(30_000) })], 'T');
    expect(md).toContain('あ'.repeat(20_000));
    expect(md).not.toContain('あ'.repeat(20_001));
  });

  it('本文が無くても壊れない', () => {
    expect(() => buildMarkdown([article({ contentText: null })], 'T')).not.toThrow();
  });

  it('記事が0件でも見出しだけ返す', () => {
    expect(buildMarkdown([], 'T')).toBe('# T（0件）\n');
  });

  it('日付が壊れていてもそのまま載せる', () => {
    expect(buildMarkdown([article({ publishedAt: 'いつか' })], 'T')).toContain('/ いつか');
  });
});

describe('safeFileName', () => {
  it('ファイル名に使えない文字を置き換える', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('80字で切る', () => {
    expect(safeFileName('あ'.repeat(200))).toHaveLength(80);
  });

  it('普通のタイトルはそのまま', () => {
    expect(safeFileName('RSSTube ダイジェスト 2026-08-11')).toBe('RSSTube ダイジェスト 2026-08-11');
  });
});

describe('原語の見出し（0023）', () => {
  const base = { url: 'https://example.com/a', contentOk: true };

  it('訳した見出しがあればそれを使い、原題も残す', () => {
    const md = buildMarkdown(
      [{ ...base, title: 'Google is making private AI practical', titleJa: 'Googleが準同型暗号で秘匿AI推論を実用化', contentText: 'Today we are excited...' }],
      'ダイジェスト',
    );
    expect(md).toContain('## 1. Googleが準同型暗号で秘匿AI推論を実用化');
    // 元記事を探すときに原題が要る。消してはいけない。
    expect(md).toContain('- 原題: Google is making private AI practical');
    // 本文が原語であることを断らないと、音声まで原語に引きずられる。
    expect(md).toContain('以下の本文は原語です');
  });

  it('訳が無ければ原題のまま。余計な行も足さない', () => {
    const md = buildMarkdown([{ ...base, title: '日本語の記事', contentText: '本文' }], 'ダイジェスト');
    expect(md).toContain('## 1. 日本語の記事');
    expect(md).not.toContain('- 原題:');
    expect(md).not.toContain('以下の本文は原語です');
  });

  it('見出しが原題と同じなら原題行を出さない', () => {
    // 日本語の記事は title_ja がほぼ同じ文字列で返る。二重に出すと読みにくい。
    const md = buildMarkdown([{ ...base, title: '同じ見出し', titleJa: '同じ見出し', contentText: '本文' }], 'x');
    expect(md).not.toContain('- 原題:');
  });

  it('本文が無いときは空行だけを積まない', () => {
    const md = buildMarkdown([{ ...base, title: 'タイトル', contentText: null }], 'x');
    expect(md).not.toContain('以下の本文は原語です');
    expect(md).toContain('## 1. タイトル');
  });
});
