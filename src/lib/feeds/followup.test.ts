import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { pickFollowups } from '@/lib/feeds/followup';

/**
 * 「本体は別にある」の見つけ方。
 *
 * 実在のページ（厚労省）で踏んだ形をそのまま残してある。**当てにいくテストより、
 * 当ててはいけないテストのほうが大事**——間違った先を本文にすると、
 * 読んでも気づけない嘘の要約ができる。
 */

const page = (body: string) =>
  parseHTML(`<!DOCTYPE html><html><body class="t-mhlw nav03">${body}</body></html>`).document;

describe('pickFollowups', () => {
  it('本文の中のPDFを本体として拾う', () => {
    const document = page(`
      <div id="headerNavi"><ul class="menu"><li><a href="/sitemap/">サイトマップ</a></li></ul></div>
      <div class="section"><p><a href="dl/doukou_r07.pdf">歯科医療費の動向</a></p></div>
      <div id="footerNavi"><ul class="menu"><li><a href="/chosakuken/">著作権</a></li></ul></div>
    `);

    expect(pickFollowups(document, 'https://www.mhlw.go.jp/topics/medias/year/25/shika.html')).toEqual([
      {
        url: 'https://www.mhlw.go.jp/topics/medias/year/25/dl/doukou_r07.pdf',
        kind: 'pdf',
        label: '歯科医療費の動向',
      },
    ]);
  });

  it('body の class は枠の印として数えない', () => {
    // 厚労省は <body class="t-mhlw nav03">。ここを見ると nav に当たって
    // **ページ中のリンクが1本残らず枠扱いになる**（実際にこれで候補ゼロだった）。
    const document = page('<div class="l-contentMain"><a href="/content/001.pdf">資料</a></div>');

    expect(pickFollowups(document, 'https://www.mhlw.go.jp/stf/newpage_1.html')).toHaveLength(1);
  });

  it('議事次第と委員名簿は後回しにする', () => {
    const document = page(`
      <ul class="m-listLink">
        <li><a href="/content/1.pdf">議事次第［PDF形式：84KB］</a></li>
        <li><a href="/content/2.pdf">委員名簿［PDF形式：99KB］</a></li>
        <li><a href="/content/3.pdf">資料１ 指定難病に係る新規の疾病追加について</a></li>
        <li><a href="/content/4.pdf">資料２ 診断基準及び重症度分類について</a></li>
      </ul>
    `);

    const picked = pickFollowups(document, 'https://www.mhlw.go.jp/stf/newpage_2.html');
    expect(picked.map((p) => p.url)).toEqual([
      'https://www.mhlw.go.jp/content/3.pdf',
      'https://www.mhlw.go.jp/content/4.pdf',
      'https://www.mhlw.go.jp/content/1.pdf',
    ]);
  });

  it('枠の中のリンクは見ない', () => {
    const document = page(`
      <nav><a href="/guide/kiyaku.pdf">利用規約</a></nav>
      <div id="footer"><a href="/privacy.pdf">個人情報保護方針</a></div>
      <p class="topicpath"><a href="/seisaku/index.html">政策について</a></p>
    `);

    expect(pickFollowups(document, 'https://example.jp/news/1.html')).toEqual([]);
  });

  it('節の入口（index.html・ディレクトリ）は本体にしない', () => {
    // 「協議会の開催について」から一段上を読むと、その回の案内ではなく
    // 協議会そのものの説明が本文になる。どの記事にもそれらしく当たってしまう。
    const document = page('<div><a href="index.html">野田保健所感染症診査協議会</a></div>');

    expect(
      pickFollowups(document, 'https://www.pref.chiba.lg.jp/kf-noda/shingikai/kyougikai/kaisai.html'),
    ).toEqual([]);
  });

  it('候補が多いページ（一覧・目次）は何も追わない', () => {
    const links = Array.from(
      { length: 8 },
      (_, i) => `<li><a href="kiji${i}.html">記事の見出しその${i}</a></li>`,
    ).join('');

    expect(pickFollowups(page(`<ul>${links}</ul>`), 'https://example.jp/news/index2.html')).toEqual([]);
  });

  it('別サイトのページは追わない（PDFは追う）', () => {
    const document = page(`
      <div><a href="https://other.example.com/honbun.html">本文はこちらの詳しい記事</a></div>
    `);

    expect(pickFollowups(document, 'https://example.jp/news/1.html')).toEqual([]);
  });

  it('開けない添付（Excel・Word）は候補にしない', () => {
    const document = page('<div><a href="dl/doukou.xlsx">歯科医療費の動向</a></div>');

    expect(pickFollowups(document, 'https://example.jp/news/1.html')).toEqual([]);
  });

  it('見出しと重なるリンクは、場所が離れていても本体とみなす', () => {
    const document = page('<div><a href="/2026/report/honbun.html">令和8年度の調査結果について</a></div>');

    const picked = pickFollowups(
      document,
      'https://example.jp/news/1.html',
      '令和8年度の調査結果について｜例示県',
    );
    expect(picked).toEqual([
      { url: 'https://example.jp/2026/report/honbun.html', kind: 'html', label: '令和8年度の調査結果について' },
    ]);
  });

  it('見出しとも場所とも関係ないリンクは追わない', () => {
    const document = page('<div><a href="/other/kanren.html">関連するお知らせの一覧</a></div>');

    expect(pickFollowups(document, 'https://example.jp/news/1.html', '調査結果について')).toEqual([]);
  });
});
