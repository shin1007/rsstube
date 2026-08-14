import { discoverFeeds } from '@/lib/feeds/discover';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 301 が返らないまま行方不明になったフィードを探し直す。
 *
 * 巡回は 301 / 308 を見て移転先を覚えるが、それが効くのは**古いURLが
 * リダイレクトを返してくれる場合だけ**。実際にはこういう壊れ方のほうが多い:
 *
 *   - CMS を入れ替えて、古いパスがいきなり 404 になる
 *   - フィードのパスだけ変わり、旧パスは何も返さない
 *   - 旧パスが 200 を返すが中身が HTML になっている（解析に失敗する）
 *
 * どれもリダイレクトが無いので追えない。残っている手がかりはサイトのURLだけなので、
 * そこから登録時と同じ手順（link タグ → よくある場所）で探し直す。
 *
 * 見つけたら feeds.url を差し替える。**購読・フォルダ・既読はフィードの id に
 * 紐づいている**ので、購読をやめて登録し直すのと違って何も失わない。
 */

export type RelocateResult =
  | { status: 'moved'; url: string; title: string }
  | { status: 'same' }
  | { status: 'not-found' }
  | { status: 'taken' };

export async function relocateFeedUrl(
  db: SupabaseClient,
  feed: { id: string; url: string; site_url?: string | null; title?: string | null },
): Promise<RelocateResult> {
  // サイトのURLが分かっていればそこから。無ければフィードURLのドメインから。
  let from: string;
  try {
    from = feed.site_url || new URL(feed.url).origin;
  } catch {
    return { status: 'not-found' };
  }

  let found;
  try {
    found = await discoverFeeds(from);
  } catch {
    return { status: 'not-found' };
  }

  const next = found[0];
  if (!next) return { status: 'not-found' };
  if (next.url === feed.url) return { status: 'same' };

  // 移転先が既に別の行として登録されていることがある（移転前と移転後を
  // 両方購読していた場合）。feeds.url は一意なので書き換えられない。
  const { data: taken } = await db.from('feeds').select('id').eq('url', next.url).maybeSingle();
  if (taken && taken.id !== feed.id) return { status: 'taken' };

  const { error } = await db
    .from('feeds')
    .update({
      url: next.url,
      title: next.title || feed.title || '',
      site_url: next.siteUrl ?? feed.site_url ?? null,
      // 移転先の中身は別物なので、条件付きGETの値と失敗回数はやり直す。
      etag: null,
      last_modified: null,
      error_count: 0,
      last_error: null,
    })
    .eq('id', feed.id);
  if (error) return { status: 'not-found' };

  return { status: 'moved', url: next.url, title: next.title };
}

/**
 * 自動で探し直すかどうか。
 *
 * 毎回やると、落ちているだけのフィードに対して巡回のたびに数回の追加リクエストが
 * 飛ぶ。一時的な不調（1〜2回）では動かず、続けて失敗したときだけ試す。
 * それでも駄目なら間隔を空けて、諦めきらない程度に繰り返す。
 */
export function shouldAutoRelocate(errorCount: number): boolean {
  if (errorCount < 3) return false; // 一時的な不調では動かない
  if (errorCount === 3) return true; // 続けて失敗したので1回試す
  return errorCount % 10 === 0; // 以後は10回ごと（サイト側が直ることもある）
}
