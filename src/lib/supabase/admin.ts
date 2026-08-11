import { createClient } from '@supabase/supabase-js';

/**
 * cron / ワーカー専用のクライアント。
 *
 * Secret キー（旧 service_role）を使うので RLS を迂回する。バックグラウンド処理には
 * ログインセッションが無く auth.uid() が null になるため、user_id は
 * OWNER_USER_ID を明示的に入れる必要がある。
 * このモジュールは絶対に Client Component から import しないこと。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SECRET_KEY が必要です');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function ownerUserId(): string {
  const id = process.env.OWNER_USER_ID;
  if (!id) throw new Error('OWNER_USER_ID が設定されていません');
  return id;
}

/**
 * cron / ワーカーのルートを保護する共有シークレットの検証。
 * pg_cron と Vercel Cron が Authorization: Bearer で送ってくる。
 */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
