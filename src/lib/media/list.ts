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
  /**
   * 元記事のURL。記事1本ぶんの音声のときだけ入る。
   * ダイジェストは束ねた記事が複数あるので、1本には決まらない（再生ページで一覧にする）。
   */
  sourceUrl: string | null;
  /** 最初に再生した時刻。null なら未視聴（一覧に印を出し、タブのバッジで数える）。 */
  playedAt: string | null;
};

/** 音声のもとになった記事。再生ページから元記事へ辿るために出す。 */
export type MediaSource = {
  title: string;
  url: string;
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
    .select(
      'id, kind, title, status, duration_sec, created_at, last_error, played_at,' +
        ' media_segments (audio_path), articles (url)',
    )
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
    played_at: string | null;
    media_segments: { audio_path: string | null }[];
    // media.article_id の参照先。ダイジェストは article_id が null なので来ない。
    articles: { url: string } | null;
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
    sourceUrl: m.articles?.url ?? null,
    playedAt: m.played_at,
  }));
}

/**
 * まだ一度も聴いていない音声の数。サイドバーと下部タブのバッジに出す。
 *
 * **数えるのは ready だけ。** 生成中のものを混ぜると、押しても聴けないぶんまで
 * バッジが出て「開いたのに聴くものが無い」になる（できあがれば ready になり、
 * そのとき数に入る）。失敗したものも未視聴ではないので数えない。
 *
 * 行は引かずに件数だけ取る。全ページの描画で1回ずつ通るところなので、
 * 台本や署名まで連れてこない。
 */
export async function unplayedMediaCount(): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ready')
    .is('played_at', null);

  return count ?? 0;
}

export async function getPlayable(id: string): Promise<{
  title: string;
  status: MediaSummary['status'];
  slides: Slide[];
  segments: PlayableSegment[];
  /** 表紙画像の署名付きURL。記事に絵が無ければ null（スライドは文字だけになる）。 */
  coverUrl: string | null;
  /** もとになった記事。記事1本なら1件、ダイジェストなら束ねた件数ぶん。 */
  sources: MediaSource[];
  /** できあがったセグメント数 / 全体。残り時間の見当に使う。 */
  doneSegments: number;
  totalSegments: number;
} | null> {
  const supabase = await createClient();

  const { data: media } = await supabase
    .from('media')
    .select('id, title, status, slides, cover_path, kind, article_id, digest_id')
    .eq('id', id)
    .maybeSingle();
  if (!media) return null;

  const { data: rows } = await supabase
    .from('media_segments')
    .select('idx, slide_idx, text, audio_path, duration_sec')
    .eq('media_id', id)
    .order('idx');

  const all = rows ?? [];
  const ready = all.filter((r) => r.audio_path);

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
    sources: await loadSources(supabase, media),
    doneSegments: ready.length,
    totalSegments: all.length,
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

/**
 * その音声のもとになった記事を、話した順に返す。
 *
 * 聴いていて「元記事を読みたい」と思ったときに辿れないと、音声が行き止まりになる。
 * ダイジェストは束ねた記事ぶん並べる（digests.article_ids が選抜順）。
 *
 * **並べ替えは in() の結果ではなく article_ids の順で行う。** PostgREST は
 * in() に渡した順では返さないので、DB から来た順に出すと話した順とずれる。
 */
async function loadSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  media: { kind: string; article_id: string | null; digest_id: string | null },
): Promise<MediaSource[]> {
  let ids: string[] = [];

  if (media.kind === 'article' && media.article_id) {
    ids = [media.article_id];
  } else if (media.digest_id) {
    const { data: digest } = await supabase
      .from('digests')
      .select('article_ids')
      .eq('id', media.digest_id)
      .maybeSingle();
    ids = (digest?.article_ids ?? []) as string[];
  }

  if (ids.length === 0) return [];

  const { data } = await supabase.from('articles').select('id, title, url').in('id', ids);

  const byId = new Map(
    ((data ?? []) as { id: string; title: string; url: string }[]).map((a) => [a.id, a]),
  );

  // 消えた記事（保持期間の掃除）は飛ばす。
  return ids.flatMap((id) => {
    const a = byId.get(id);
    return a ? [{ title: a.title, url: a.url }] : [];
  });
}
