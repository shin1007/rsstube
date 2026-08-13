import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

/**
 * Web Push の送信。
 *
 * 通知そのものの組み立てはサービスワーカー側（public/sw.js の push ハンドラ）で、
 * ここは「誰の端末へ、どの JSON を送るか」だけを見る。
 *
 * VAPID は「送信元がこのアプリであること」を push サービスに示すための鍵。
 * 公開鍵はブラウザ側の購読時にも要るので NEXT_PUBLIC_ で渡す。秘密鍵はサーバー専用。
 */

export type PushPayload = {
  title: string;
  body: string;
  /** タップしたときに開く場所。 */
  url?: string;
  /** 同じタグの通知は積み上がらず置き換わる。 */
  tag?: string;
};

/** 鍵が入っていなければ何もしない（通知を使わない構成でもアプリは動く）。 */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

function configure() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export type SendResult = { sent: number; removed: number; failed: number };

/**
 * 1ユーザーの全端末へ送る。
 *
 * 失敗しても投げない。通知が届かないことより、通知の失敗でダイジェスト生成が
 * 巻き戻るほうが困る（呼び出し元の cron は通知の後に何も戻せない）。
 */
export async function sendToUser(
  db: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  if (!pushConfigured()) return result;

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error || !subs?.length) return result;

  configure();
  const body = JSON.stringify(payload);
  const now = new Date().toISOString();

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        // 端末が圏外でも、朝のうちに届けばいい。それを過ぎたら捨ててよい。
        { TTL: 6 * 60 * 60 },
      );
      result.sent++;
      await db
        .from('push_subscriptions')
        .update({ last_sent_at: now })
        .eq('endpoint', sub.endpoint);
    } catch (err) {
      // 404/410 は「その購読先はもう無い」。ブラウザの再インストールや
      // 通知の拒否で起きる。残しておいても毎朝失敗し続けるだけなので消す。
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        result.removed++;
      } else {
        result.failed++;
      }
    }
  }

  return result;
}
