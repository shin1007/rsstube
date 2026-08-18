'use server';

import { attempt } from '@/lib/actions/result';

import { sendToUser, pushConfigured } from '@/lib/push/send';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 通知の登録・解除・テスト送信。
 *
 * 実際に通知を出すのはサービスワーカーで、こちらは購読先を DB に置くだけ。
 * ブラウザの購読オブジェクト（endpoint と2つの鍵）をそのまま預かる。
 */

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function savePushSubscription(input: PushSubscriptionInput) {
  return attempt(() => savePushSubscriptionImpl(input));
}

async function savePushSubscriptionImpl(input: PushSubscriptionInput): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: input.endpoint,
      user_id: auth.user.id,
      p256dh: input.p256dh,
      auth: input.auth,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;

  revalidatePath('/settings');
}

export async function removePushSubscription(endpoint: string) {
  return attempt(() => removePushSubscriptionImpl(endpoint));
}

async function removePushSubscriptionImpl(endpoint: string): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;

  revalidatePath('/settings');
}

/**
 * テスト送信。
 *
 * 通知は「届かないこと」が分かりにくい。権限・購読・鍵・サービスワーカーと
 * 噛み合うところが多いので、朝を待たずに1回試せる導線を置いておく。
 */
export async function sendTestPush() {
  return attempt(() => sendTestPushImpl());
}

async function sendTestPushImpl(): Promise<string> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('未ログインです');

  if (!pushConfigured()) {
    throw new Error('VAPID の鍵が設定されていません（.env の VAPID_* を確認してください）');
  }

  const result = await sendToUser(supabase, auth.user.id, {
    title: 'RSSTube',
    body: 'テスト通知です。これが見えていれば、朝のダイジェストも届きます。',
    url: '/exports',
    tag: 'rsstube-test',
  });

  if (result.sent === 0 && result.removed > 0) {
    return '登録が期限切れでした。もう一度オンにしてください。';
  }
  if (result.sent === 0) {
    return '送信できる端末がありません。通知をオンにしてください。';
  }
  return `${result.sent}台に送りました。`;
}
