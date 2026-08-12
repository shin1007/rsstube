import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 では middleware は proxy に改称された。
 *
 * ここでやることは2つだけ:
 *   1. Supabase のセッションCookieを更新する（Server Component からは書けないため）
 *   2. 未ログインならログイン画面へ飛ばす
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() を呼ぶことでトークンの検証と更新が走る。
  // Supabase に到達できないときは「未ログイン」として扱う（開けてしまうより安全）。
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  const isAuthPage = request.nextUrl.pathname.startsWith('/login');
  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的ファイルと、シークレットで別途保護している cron/ワーカーは対象外。
     * matcher を書かないと CSS や画像まで認証にかかる。
     *
     * auth/ も外す。マジックリンクのコールバックは「まだセッションが無い状態」で
     * 来るので、ここを通すと /login へ弾かれてログインが成立しない。
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|auth|api/cron|api/jobs|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
