import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * スライドの表紙画像を Storage へ写す。
 *
 * 記事の og:image をそのまま <img> に貼らないのは2つ理由がある。
 * 相手のサイトに毎回取りに行くことになるのと、記事が消えると絵だけ先に
 * 欠けること（音声は既定14日残る）。1枚だけこちらに写しておけば完結する。
 *
 * 写すのは media 1本につき1枚。全記事ぶんを溜めると Storage の無料枠(1GB)を
 * 音声と奪い合う（音声は10分で約4.6MB）。
 *
 * 絵が無い記事のほうが多い前提で書く。失敗しても音声づくりは止めない
 * ——表紙が無ければスライドは文字だけで描かれる。
 */

const BUCKET = 'media';

/** 表紙1枚の上限。これを超える絵は元サイズが大きすぎるので諦める。 */
const MAX_BYTES = 4 * 1024 * 1024;

/** 相手のサーバー次第でいくらでも待たされる。表紙のために音声を止めない。 */
const TIMEOUT_MS = 10_000;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/**
 * 画像を取ってきて Storage に置く。置けたらそのパスを返す。
 *
 * @returns Storage 上のパス。取れなければ null。
 */
export async function storeCover(
  db: SupabaseClient,
  userId: string,
  mediaId: string,
  imageUrl: string | null | undefined,
): Promise<string | null> {
  if (!imageUrl) return null;

  // http/https 以外は取りに行かない。file: や data: を渡されて
  // サーバーの中を読ませないため（URL は第三者のサイト由来）。
  let target: URL;
  try {
    target = new URL(imageUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;

  try {
    const res = await fetch(target, {
      headers: {
        // UA は正直に名乗る。偽装しても弾かれるところは弾かれる（CLAUDE.md）。
        'User-Agent': 'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)',
        Accept: 'image/*',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = EXT[contentType];
    // 知らない形式は置かない。HTML のエラーページを画像として掴むことがある。
    if (!ext) return null;

    // Content-Length で足切りしてから読む。無い相手のときは読んだあとで測る。
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    // パスの先頭が持ち主。読み取りポリシーがここを見る（0010）。
    const path = `${userId}/${mediaId}/cover.${ext}`;
    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;

    return path;
  } catch {
    // 相手の 403 もタイムアウトも珍しくない。表紙が無いだけなので黙って諦める。
    return null;
  }
}
