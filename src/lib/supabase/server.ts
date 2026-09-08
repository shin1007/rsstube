import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { keepAliveFetch } from '@/lib/supabase/fetch';

/**
 * Server Component / Route Handler から使う Supabase クライアント。
 * ログイン中のユーザーとして動くので RLS がそのまま効く。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // 接続を保つ fetch を渡す。**空いた時間ぶん張り直していた**のが、
      // 起動の待ちの正体だった（lib/supabase/fetch.ts）。
      global: { fetch: keepAliveFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /**
             * Server Component からは Cookie を書けない。
             *
             * **ここに来るのは「更新が起きた」ということ**なので、黙って
             * 捨ててよい場面かどうかは呼び出し側で決まる。画面の描画では
             * そもそも更新を起こさない（期限は lib/auth/guard.ts が先に見て、
             * 切れていれば /auth/refresh へ送る）。Route Handler と
             * Server Action からは書けるので、そこでは捨てられない。
             */
          }
        },
      },
    },
  );
}
