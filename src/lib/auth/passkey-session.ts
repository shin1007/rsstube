import { isAllowedEmail } from '@/lib/auth/allowlist';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * パスキーの検証が通ったあと、そのユーザーとしてログインした状態を作る。
 *
 * Supabase の Auth に WebAuthn は無いので、「こちらで本人だと確かめた」ことを
 * 向こうに伝える口が要る。使えるのは Secret キーの admin API だけで、
 * セッションを直接発行するメソッドは公開されていない。
 *
 * そこで **マジックリンクを1本作り、そのトークンを自分で使う**。
 * `generateLink` はメールを送らずに token_hash を返してくるので、それを
 * `verifyOtp` に渡すと、いつものメールのリンクを踏んだのと同じ経路で
 * セッション Cookie が付く。**Route Handler から呼ぶこと**——Server Component
 * からは Cookie を書けないので、セッションが付かないまま成功が返る。
 *
 * この関数を呼ぶ前に、必ず署名の検証を済ませておくこと。ここは「本人だと分かった
 * あとの手続き」しかしない。
 *
 * ALLOWED_EMAILS の確認は**ここでやる**。呼ぶ側に任せると、入口を1つ足した日に
 * 忘れる種類の確認で、忘れても普通にログインできてしまうので気づけない。
 */
export async function signInAsUser(userId: string): Promise<{ email: string }> {
  const admin = createAdminClient();

  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user?.email) {
    throw new Error('このパスキーに対応するユーザーが見つかりません');
  }
  const email = user.user.email;

  // 許可していないアドレスには、鍵が正しくてもセッションを作らない
  // （パスワードの入口と同じ壁を、こちらにも立てる）。
  if (!isAllowedEmail(email)) {
    throw new Error('このアカウントではログインできません');
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError || !link.properties?.hashed_token) {
    throw new Error(`ログインの手続きに失敗しました: ${linkError?.message ?? 'トークンがありません'}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    // メールのリンクと同じ種類。'magiclink' ではなく 'email' を渡す
    // （token_hash から入るときの型はこちら）。
    type: 'email',
    token_hash: link.properties.hashed_token,
  });
  if (error) throw new Error(`ログインの手続きに失敗しました: ${error.message}`);

  return { email };
}
