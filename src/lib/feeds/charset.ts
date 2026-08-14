/**
 * 文字コードの判定。
 *
 * `res.text()` は Content-Type の charset を見て、無ければ UTF-8 として読む。
 * 日本のサイト、特に自治体や省庁には **Shift_JIS や EUC-JP がまだ現役で残っていて**、
 * しかも Content-Type に charset を書かず HTML の meta にだけ書いていることがある。
 * そのまま UTF-8 で読むと丸ごと文字化けする。
 *
 * 厄介なのは、文字化けしても**長さはあるので抽出は「成功」に見える**こと。
 * 化けた文字列がそのまま要約に回り、AI が意味の無い文章を要約しようとする。
 * 実例: https://www.mhlw.go.jp/toukei/list/105-1c.html は
 * Content-Type が `text/html`（charset なし）で meta が `shift_jis`。
 *
 * 見る順番は HTML の仕様に沿う: Content-Type → BOM → meta。
 */

/** meta を探す範囲。仕様上 head の先頭付近にあるので、これで足りる。 */
const SNIFF_BYTES = 2048;

/**
 * 表記ゆれを Node が知っている名前に寄せる。
 * `shift-jis` `x-sjis` `sjis` などは全部同じもの。
 */
function normalize(label: string): string {
  const s = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (/^(shift[-_]?jis|x-sjis|sjis|ms_kanji|windows-31j|cp932)$/.test(s)) return 'shift_jis';
  if (/^(euc[-_]?jp|x-euc-jp)$/.test(s)) return 'euc-jp';
  if (/^(iso-?2022-?jp)$/.test(s)) return 'iso-2022-jp';
  if (/^(utf-?8|unicode-1-1-utf-8)$/.test(s)) return 'utf-8';
  return s;
}

/** Node が知らない名前だと TextDecoder が投げるので、使えるものだけ通す。 */
function usable(label: string): string | null {
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return null;
  }
}

export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  // 1. Content-Type の charset。サーバーが明示しているならそれが最優先。
  const fromHeader = contentType ? /charset=([^;\s]+)/i.exec(contentType)?.[1] : undefined;
  if (fromHeader) {
    const ok = usable(normalize(fromHeader));
    if (ok) return ok;
  }

  // 2. BOM。付いていれば中身より確実。
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';

  // 3. HTML の meta。先頭を latin1 として読むのは、どの1バイト文字コードでも
  //    ASCII 部分は同じに見えるため（meta の宣言自体は ASCII で書かれている）。
  const head = Buffer.from(bytes.subarray(0, SNIFF_BYTES)).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    // XML 宣言（RSS/Atom はこちら）。
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1];
  if (fromMeta) {
    const ok = usable(normalize(fromMeta));
    if (ok) return ok;
  }

  return 'utf-8';
}

/** 応答のバイト列を、正しい文字コードで文字列にする。 */
export function decodeBody(contentType: string | null, bytes: Uint8Array): string {
  const charset = detectCharset(contentType, bytes);
  // fatal: false なので、壊れたバイトがあっても置換文字になるだけで投げない。
  return new TextDecoder(charset).decode(bytes);
}
