import { extractText, getDocumentProxy } from 'unpdf';

/**
 * PDF から本文を取る。
 *
 * 官公庁や自治体には**ページ本体がPDFだけ**という記事が普通にある
 * （例: 厚労省の「○○の動向」は、HTMLには表題とPDFへのリンクしか無い）。
 * HTMLだけを見ていると本文200字未満で「取得失敗」に落ちるが、
 * 中身はPDFの中に全部ある。実測でこの1本が35ページ・54,605字だった。
 *
 * 使うのは unpdf。pdfjs をサーバーレス向けに固めたもので、依存が無く
 * canvas も要らない。**依存を足したら本番でも1回叩いて確かめること**
 * （jsdom@30 が Vercel だけで ERR_REQUIRE_ESM になった前科がある）。
 */

/** 取りに行くPDFの上限。これを超えるものは読まずに諦める。 */
const MAX_BYTES = 20 * 1024 * 1024;

/** 読むページ数の上限。白書のような数百ページを丸ごと解くと時間予算を食う。 */
const MAX_PAGES = 60;

const USER_AGENT = 'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)';

export type PdfText = { text: string; pages: number };

/** PDFを取ってきて、中の文字を読む。読めなければ null（画像だけのPDFはこれ）。 */
export async function fetchPdfText(url: string): Promise<PdfText | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,*/*' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  // Content-Length は嘘のこともあるので、読み終わってからも見る。
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return null;

  return readPdf(bytes);
}

/** バイト列から読む。取得と分けてあるのは、記事URLが直接PDFのときに使い回すため。 */
export async function readPdf(bytes: Uint8Array): Promise<PdfText | null> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).slice(0, MAX_PAGES);
  const joined = pages.join('\n\n').trim();
  // 文字レイヤの無いPDF（紙をスキャンしただけのもの）はここが空になる。
  // OCR はしない——無料枠でも時間予算でも合わないし、読めないものは
  // 「読めなかった」と分かるほうがよい。
  if (!joined) return null;
  return { text: joined, pages: totalPages };
}

/**
 * PDFの行を、読める段落にまとめ直す。
 *
 * PDFの改行は**紙の行の終わり**であって文の切れ目ではない。そのまま出すと
 * 一文が何行にも割れ、日本語では単語の途中で切れて見える。
 *
 * - 空行は段落の区切りとして扱う
 * - 文末（。！？.!?）で終わる行のあとも段落を切る。PDFには段落の空行が
 *   ほとんど入っていないので、これが無いと全部が一つの塊になる
 * - 行をつなぐときの区切りは、両端が日本語なら詰めて、そうでなければ空白。
 *   日本語に空白を入れると分かち書きのように見え、英文で詰めると単語がくっつく
 */
export function pdfTextToParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) paragraphs.push(trimmed);
    current = '';
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (!current) {
      current = line;
    } else {
      current += joiner(current[current.length - 1], line[0]) + line;
    }
    if (/[。！？!?]$/.test(line)) flush();
  }
  flush();

  return paragraphs;
}

/** 日本語どうしなら詰める。片方でも欧文なら空白を入れる。 */
function joiner(before: string, after: string): string {
  return isCjk(before) && isCjk(after) ? '' : ' ';
}

function isCjk(ch: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。、（）「」［］・…ー〜：；！？％]/u.test(ch);
}
