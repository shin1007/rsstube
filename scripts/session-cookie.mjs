import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

/**
 * 計測用のセッション Cookie を作る。**パスワードは要らない。**
 *
 * Secret キーで magiclink を1本作り、その `hashed_token` をこちらで `verifyOtp`
 * してセッションにする（メールは飛ばない。`lib/auth/passkey-session.ts` と同じ手口）。
 *
 * **Cookie の形は @supabase/ssr に作らせる。** `base64-` を付けて base64url に
 * するのも、3180文字で `.0` `.1` … に割るのも向こうの都合で、こちらで組み立てると
 * 版が上がった日に静かにずれる（そして「未ログイン扱いで 307」が返り、
 * *速くなった*ように見えてしまう）。ここでは受け皿だけ用意して、書かれたものを
 * そのまま繋ぐ。
 *
 * 中身は生きたトークンなので、**ファイルに書かないこと**。使うプロセスの中だけに置く。
 */
/**
 * 上と同じ手口で、Cookie の名前→値を `Map` のまま返す。
 *
 * `sessionCookie()` は文字列にして返すだけなので、期限を書き換えて
 * 「切れたセッション」を作りたいとき（`cold-start-probe.mjs`）は
 * こちらを使う。名前だけで `sb-<ref>-auth-token` を拾えるように、
 * ここで組み立てる jar の中身は変えていない。
 */
export async function sessionCookieJar() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const owner = process.env.OWNER_USER_ID;

  if (!url || !secret || !publishable || !owner) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / OWNER_USER_ID が要ります',
    );
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: user } = await admin.auth.admin.getUserById(owner);
  const email = user?.user?.email;
  if (!email) throw new Error('OWNER_USER_ID のユーザーが見つかりません');

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;

  const jar = new Map();
  const session = createServerClient(url, publishable, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) jar.set(c.name, c.value);
      },
    },
  });

  const { error: authError } = await session.auth.verifyOtp({
    type: 'email',
    token_hash: link.properties.hashed_token,
  });
  if (authError) throw authError;

  return jar;
}

export async function sessionCookie() {
  const jar = await sessionCookieJar();
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
