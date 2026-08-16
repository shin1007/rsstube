import { parseHTML } from 'linkedom';

/**
 * 記事HTMLの消毒。
 *
 * 本文をそのまま描画するということは、**第三者が書いたHTMLを自分のページで動かす**
 * ということ。フィードの中身は誰でも書けるので、素通しにすると記事を1本読むだけで
 * セッションを抜かれる。許可したものだけを残し、それ以外は落とす方針にする
 * （禁止リストにすると、知らない書き方が抜ける）。
 *
 * 落とすもののうち特に効くもの:
 *   - script / style / on* 属性        任意のコードが動く
 *   - javascript: や data: のURL       クリックやsrcで同じことが起きる
 *   - form / input                     偽のログイン欄を出せる
 *   - iframe（許可した動画サイト以外）  中で何でもできる
 *
 * 逆に、読むために要るものは残す: 段落・見出し・リスト・引用・表・コード・
 * 画像・リンク・そして動画の埋め込み。
 */

/** 残すタグ。ここに無いものは、中身のテキストだけ残して枠を外す。 */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'BLOCKQUOTE', 'PRE', 'CODE', 'FIGURE', 'FIGCAPTION',
  'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SUB', 'SUP', 'MARK', 'SMALL',
  'A', 'IMG', 'PICTURE', 'SOURCE',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
  'IFRAME', 'VIDEO', 'AUDIO',
  'SPAN', 'DIV', 'SECTION', 'ARTICLE',
]);

/** 中身ごと消すタグ。テキストも残さない。 */
const DROP_ENTIRELY = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
  'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LABEL',
  'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE',
]);

/** タグごとに残す属性。ここに無い属性は全部落とす（on* もこれで消える）。 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  IMG: new Set(['src', 'alt', 'title', 'width', 'height']),
  SOURCE: new Set(['src', 'srcset', 'type', 'media']),
  IFRAME: new Set(['src', 'width', 'height', 'title']),
  VIDEO: new Set(['src', 'poster', 'width', 'height', 'controls']),
  AUDIO: new Set(['src', 'controls']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan', 'scope']),
};

/**
 * iframe を許すホスト。
 *
 * iframe は中で任意のページを開けるので、動画の埋め込みという用途に絞って
 * 相手を限定する。ここに無いものは、リンクに置き換えて中身を消す。
 */
const IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
  'w.soundcloud.com',
  'embed.nicovideo.jp',
];

/** http(s) 以外の URL は通さない（javascript: や data: を弾く）。 */
function safeUrl(value: string | null, base?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function allowedIframe(src: string | null): boolean {
  if (!src) return false;
  try {
    return IFRAME_HOSTS.includes(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * @param html   Readability が整えたあとのHTML
 * @param baseUrl 記事のURL。相対パスの画像・リンクを解決するのに使う
 */
export function sanitizeHtml(html: string, baseUrl?: string): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const body = document.body;
  if (!body) return '';

  const walk = (node: Element) => {
    /*
      コメントを落とす。
      `node.children` は要素しか返さないので、コメントは走査から漏れて
      そのまま出力に残っていた（`<!--<script>…</script>-->` が素通しだった）。
      コメントの中身はブラウザが実行しないので、それ自体が穴ではない。
      ただ、本文を読むのに要るものではないし、パーサの解釈の違いを突く手口
      （mXSS）はコメントの扱いを足がかりにする。信用できない文字列を
      DOM に残しておく理由が無いので消す。
    */
    for (const child of Array.from(node.childNodes)) {
      // nodeType 8 = コメント。linkedom も同じ番号を使う。
      if ((child as { nodeType?: number }).nodeType === 8) {
        (child as unknown as { remove: () => void }).remove();
      }
    }

    // 後ろから見る。取り除いても添字がずれない。
    for (const child of Array.from(node.children).reverse()) {
      const tag = child.tagName?.toUpperCase() ?? '';

      if (DROP_ENTIRELY.has(tag)) {
        child.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // 枠だけ外して中身は残す。知らないタグで文章が消えないように。
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }

      // 属性を許可したものだけに絞る。ここで on* と style が落ちる。
      const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
      for (const attr of Array.from(child.attributes)) {
        if (!allowed.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }

      // URL を持つ属性は、中身も確かめる。
      if (tag === 'A') {
        const href = safeUrl(child.getAttribute('href'), baseUrl);
        if (href) {
          child.setAttribute('href', href);
          // 別タブで開く。開いた先から元のタブを触られないようにする。
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        } else {
          child.removeAttribute('href');
        }
      } else if (tag === 'IMG' || tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO') {
        const src = safeUrl(child.getAttribute('src'), baseUrl);
        if (src) child.setAttribute('src', src);
        else child.removeAttribute('src');
        if (tag === 'IMG') {
          // 遅延読み込みと、参照元を送らない設定。画像で閲覧履歴を渡さない。
          child.setAttribute('loading', 'lazy');
          child.setAttribute('referrerpolicy', 'no-referrer');
        }
      } else if (tag === 'IFRAME') {
        const src = safeUrl(child.getAttribute('src'), baseUrl);
        if (allowedIframe(src)) {
          child.setAttribute('src', src as string);
          // 中でできることを最小限に絞る。
          child.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
          child.setAttribute('loading', 'lazy');
          child.setAttribute('referrerpolicy', 'no-referrer');
        } else {
          // 許していない相手は、開けるリンクだけ残して枠を消す。
          if (src) {
            const link = document.createElement('a');
            link.setAttribute('href', src);
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            link.textContent = src;
            child.replaceWith(link);
          } else {
            child.remove();
          }
          continue;
        }
      }

      walk(child);
    }
  };

  walk(body);
  return body.innerHTML.trim();
}
