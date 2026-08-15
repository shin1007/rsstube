import { createClient } from '@/lib/supabase/server';
import { safeFileName } from '@/lib/export/markdown';
import { type NextRequest } from 'next/server';

/**
 * 音声を1本の MP3 にまとめて渡す。
 *
 * サーバー側の音声は30日で消える（settings.media_retention_days、
 * /api/cron/purge が Storage のファイルごと落とす）。Storage の無料枠が1GBで、
 * 1本あたり実測473KB/分あるため、溜め続けると他が入らなくなる。
 * 手元に置いておきたいものは、消える前に落としてもらう前提にした。
 *
 * セグメントは独立した MP3 なので、**連結するだけで通しで再生できる**。
 * 再エンコードは要らない（ffmpeg をサーバーレスに持ち込まずに済む）。
 *
 * 認証は RLS 任せ。media も media_segments も持ち主しか読めないので、
 * 他人の id を入れても行が取れずに 404 になる。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Storage の署名URLの寿命。落とすだけなので短くてよい。 */
const SIGN_TTL_SEC = 300;

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/media/[id]/download'>) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: media } = await supabase
    .from('media')
    .select('id, title, status')
    .eq('id', id)
    .maybeSingle();

  if (!media) return new Response('見つかりません', { status: 404 });

  const { data: rows } = await supabase
    .from('media_segments')
    .select('idx, audio_path')
    .eq('media_id', id)
    .order('idx');

  const paths = (rows ?? []).map((r) => r.audio_path).filter(Boolean) as string[];
  if (paths.length === 0) {
    // 生成中は「まだ無い」と分かる形で返す。空の MP3 を渡すと、
    // 落とせたのに再生できないという一番分かりにくい形になる。
    return new Response('まだ音声ができていません', { status: 409 });
  }

  const { data: signed, error } = await supabase.storage
    .from('media')
    .createSignedUrls(paths, SIGN_TTL_SEC);
  if (error) return new Response(`音声を取り出せません: ${error.message}`, { status: 502 });

  // 署名の並びは要求順とは限らないので、必ずパスで引き直して idx 順に戻す。
  const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl]));

  const parts: Uint8Array[] = [];
  for (const path of paths) {
    const url = urlByPath.get(path);
    if (!url) return new Response('音声の一部を取り出せません', { status: 502 });
    const res = await fetch(url);
    if (!res.ok) return new Response(`音声の取得に失敗しました (${res.status})`, { status: 502 });
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }

  const name = `${safeFileName(media.title || 'rsstube')}.mp3`;

  return new Response(body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(total),
      // filename* まで書くのは、日本語のタイトルをそのままファイル名にするため。
      // filename= だけだと、非ASCIIを落とすブラウザがある。
      'Content-Disposition':
        `attachment; filename="rsstube.mp3"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 保存用なので中間で持たれても困らないが、署名付きの中身なので念のため。
      'Cache-Control': 'private, no-store',
    },
  });
}
