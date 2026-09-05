import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ログイン中のユーザーを、**Supabase に聞かずに**確かめる。
 *
 * `getUser()` は毎回 Auth に往復する。proxy.ts では実測でその1往復が 250ms →
 * 116ms（＝往復ぶんが約134ms）だったので、**押すたびに走る Server Action と
 * ページ描画では、これだけで待ち時間の半分近くを使っていた**ことになる。
 * `/settings` の getDriveStatus はその上に app_config を2回読む直列が続く。
 *
 * `getClaims()` は同じ検証を WebCrypto でその場でやる。このプロジェクトの
 * 署名鍵は ES256（非対称）なので通信が要らない——公開鍵は auth-js の
 * `GLOBAL_JWKS` にプロセスごと残るので、温まった関数では往復ゼロ。
 *
 * **検証を緩めたわけではない**（proxy.ts と同じ話）。`getSession()` を直に
 * 見るのとは違い、署名を照合して `exp` も見るので、Cookie を書き換えても
 * 通らない。対称鍵の環境や WebCrypto が無い環境では auth-js が自分で
 * `getUser()` に落ちる。
 *
 * **RLS の代わりにはならない。** ここで得た id は「誰として書くか」を
 * 決めるためのもので、読み書きの可否は今までどおり RLS が決める。
 *
 * @returns 未ログインなら null。Auth に届かないときも null（開けるより安全）。
 */
export async function currentUser(
  supabase: SupabaseClient,
): Promise<{ id: string; email: string | null } | null> {
  try {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
  } catch {
    return null;
  }
}
