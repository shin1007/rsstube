import { listSubscribedFeeds } from '@/lib/subscriptions';
import { buildOpml, type OpmlFeed } from '@/lib/feeds/opml';
import { createClient } from '@/lib/supabase/server';

/**
 * 購読中のフィードを OPML で書き出す。
 *
 * 取り込みだけあって書き出しが無いと、フィード資産がこのアプリに閉じ込められる。
 * バックアップとしても、他のリーダーへ戻る道としても要る。
 *
 * cron ではなくログインした本人が押すものなので、認証は通常どおり proxy と RLS に任せる。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response('unauthorized', { status: 401 });

  const [feeds, { data: folders }] = await Promise.all([
    listSubscribedFeeds(),
    supabase.from('folders').select('id, name').order('sort_order').order('name'),
  ]);

  const folderName = new Map((folders ?? []).map((f) => [f.id, f.name]));

  const rows: OpmlFeed[] = feeds.map((f) => ({
    title: f.title || f.url,
    xmlUrl: f.url,
    htmlUrl: f.site_url ?? undefined,
    folder: f.folder_id ? folderName.get(f.folder_id) : undefined,
  }));

  const date = new Date().toISOString().slice(0, 10);

  return new Response(buildOpml(rows), {
    headers: {
      'Content-Type': 'text/x-opml+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="rsstube-${date}.opml"`,
      // 購読内容はその時点のもの。CDN にも履歴にも残さない。
      'Cache-Control': 'no-store',
    },
  });
}
