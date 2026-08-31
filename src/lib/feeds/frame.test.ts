import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { looksLikeFrame, mainRegionHtml } from '@/lib/feeds/frame';

/**
 * Readability が枠を本文として掴んだときの立て直し。
 *
 * 実例は厚労省 `stf/newpage_75898.html`（250字の記者会見の案内）。返ってきたのは
 * ヘッダーのメガメニューを含む2006字で、**100字を超えているので抽出成功に見えていた**。
 */

describe('looksLikeFrame', () => {
  it('header / nav / footer が残っていたら枠を疑う', () => {
    expect(looksLikeFrame('<div id="top"><header><a href="/">ホーム</a></header></div>')).toBe(true);
    expect(looksLikeFrame('<div><nav><ul><li>メニュー</li></ul></nav></div>')).toBe(true);
    expect(looksLikeFrame('<div><footer>Copyright</footer></div>')).toBe(true);
  });

  it('本文だけなら疑わない', () => {
    expect(looksLikeFrame('<div><p>以下のとおり実施します。</p><dl><dt>案件</dt></dl></div>')).toBe(false);
  });

  it('見出しの header ではない語に当てない（headerNavi は div）', () => {
    // タグ名で見るので、class や id に header と書いてあるだけでは当たらない。
    expect(looksLikeFrame('<div class="headerNavi"><p>本文</p></div>')).toBe(false);
  });
});

describe('mainRegionHtml', () => {
  const page = (body: string) =>
    parseHTML(`<!DOCTYPE html><html><body>${body}</body></html>`).document;

  it('main の中身を返す', () => {
    const document = page('<header>枠</header><main><p>本文</p></main><footer>枠</footer>');
    expect(mainRegionHtml(document)).toBe('<p>本文</p>');
  });

  it('role="main" も見る', () => {
    expect(mainRegionHtml(page('<div role="main"><p>本文</p></div>'))).toBe('<p>本文</p>');
  });

  it('main が無ければ null（何もしない）', () => {
    expect(mainRegionHtml(page('<div><p>本文</p></div>'))).toBeNull();
  });

  it('空の main は無いのと同じ', () => {
    expect(mainRegionHtml(page('<main>\n  \n</main>'))).toBeNull();
  });
});
