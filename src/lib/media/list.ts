import { createClient } from '@/lib/supabase/server';
import type { Slide } from '@/lib/ai/script';

/**
 * 再生側から見た音声。
 *
 * Storage のバケットは非公開なので、URL は署名付きにして都度発行する。
 * 有効期限は1本聴き通すのに足りればよい（長くすると、URLが漏れたときの
 * 有効期間もそのまま延びる）。
 */

const BUCKET = 'media';
/** 署名の有効期間。10分の番組を聴くのに十分で、長すぎない程度。 */
const SIGN_TTL_SEC = 2 * 60 * 60;

export type MediaSummary = {
  id: string;
  kind: 'article' | 'digest';
  title: string;
  status: 'queued' | 'scripting' | 'synthesizing' | 'ready' | 'failed';
  durationSec: number;
  createdAt: string;
  lastError: string | null;
  /** 出来上がったセグメント数 / 全体。生成中の進み具合を出すため。 */
  doneSegments: number;
  totalSegments: number;
};

export type PlayableSegment = {
  idx: number;
  slideIdx: number;
  text: string;
  url: string;
  durationSec: number;
};

export async function listMedia(limit = 30): Promise<MediaSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('media')
    .select('id, kind, title, status, duration_sec, created_at, last_error, media_segments (audio_path)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as {
    id: string;
    kind: 'article' | 'digest';
    title: string;
    status: MediaSummary['status'];
    duration_sec: number;
    created_at: string;
    last_error: string | null;
    media_segments: { audio_path: string | null }[];
  }[]).map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    status: m.status,
    durationSec: m.duration_sec,
    createdAt: m.created_at,
    lastError: m.last_error,
    doneSegments: m.media_segments.filter((s) => s.audio_path).length,
    totalSegments: m.media_segments.length,
  }));
}

export async function getPlayable(id: string): Promise<{
  title: string;
  status: MediaSummary['status'];
  slides: Slide[];
  segments: PlayableSegment[];
  /** 表紙画像の署名付きURL。記事に絵が無ければ null（スライドは文字だけになる）。 */
  coverUrl: string | null;
} | null> {
  const supabase = await createClient();

  const { data: media } = await supabase
    .from('media')
    .select('id, title, status, slides, cover_path')
    .eq('id', id)
    .maybeSingle();
  if (!media) return null;

  const { data: rows } = await supabase
    .from('media_segments')
    .select('idx, slide_idx, text, audio_path, duration_sec')
    .eq('media_id', id)
    .order('idx');

  const ready = (rows ?? []).filter((r) => r.audio_path);

  // 署名は1本ぶんまとめて発行する（セグメントごとに往復すると遅い）。
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(ready.map((r) => r.audio_path as string), SIGN_TTL_SEC);

  const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl]));

  // 表紙も同じバケットなので、セグメントと一緒に署名する。
  const coverUrl = media.cover_path
    ? ((await supabase.storage.from(BUCKET).createSignedUrl(media.cover_path, SIGN_TTL_SEC)).data
        ?.signedUrl ?? null)
    : null;

  return {
    title: media.title,
    status: media.status,
    coverUrl,
    slides: (media.slides ?? []) as Slide[],
    segments: ready
      .map((r) => ({
        idx: r.idx as number,
        slideIdx: r.slide_idx as number,
        text: r.text as string,
        url: urlByPath.get(r.audio_path as string) ?? '',
        durationSec: Number(r.duration_sec ?? 0),
      }))
      // 署名が取れなかったものは再生できないので落とす。
      .filter((s) => s.url),
  };
}
