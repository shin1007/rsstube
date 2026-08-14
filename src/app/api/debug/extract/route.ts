import { extractArticle } from '@/lib/feeds/extract';
import { detectCharset } from '@/lib/feeds/charset';
import { authorizeCron } from '@/lib/supabase/admin';

/**
 * 「このURLから本文を取れるか」を確かめるための窓口。
 *
 *   npm run check:url -- https://example.com/article
 *
 * ワーカーと**同じ関数**（extractArticle）を通す。手元に似たスクリプトを置くと、
 * 本物と少しずつずれて「スクリプトでは取れるのにアプリでは取れない」が起きる。
 *
 * 保存はしない。読むだけ。cron と同じシークレットで守る（任意のURLを叩かせる
 * 踏み台にしないため）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(request.url).searchParams.get('url');
  if (!url) return Response.json({ error: 'url を指定してください' }, { status: 400 });

  // 文字コードの判定だけ別に見せる。化けているときは、たいていここが原因。
  let charset = '(取得できず)';
  let contentType = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSSTube/0.1; personal feed reader)' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    contentType = res.headers.get('content-type') ?? '';
    charset = detectCharset(contentType, new Uint8Array(await res.arrayBuffer()));
  } catch {
    // 本編の extractArticle 側でも同じ失敗をするので、そちらの理由を出す。
  }

  try {
    const result = await extractArticle(url);
    return Response.json({
      url,
      contentType,
      charset,
      ok: result.ok,
      // ok=false は「200字未満だったので抽出失敗とみなした」という意味。
      length: result.text.length,
      preview: result.text.replace(/\s+/g, ' ').slice(0, 300),
    });
  } catch (err) {
    return Response.json({
      url,
      contentType,
      charset,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
