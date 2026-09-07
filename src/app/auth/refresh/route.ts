import { REFRESHED_COOKIE } from '@/lib/auth/guard';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * 期限の切れたセッションを更新して、元の画面へ戻す。
 *
 * **Cookie を書けるのは Route Handler（と Server Action）だけ**なので、更新は
 * ここに集める。Server Component から更新させると、新しい更新トークンを
 * 書き戻せずに捨てることになり、回転の仕組みごとセッションが死ぬ
 * （`lib/auth/guard.ts` の注記）。
 *
 * 以前は proxy.ts が全リクエストでこれをやっていた。**そのために毎回 80ms**
 * 払っていたので、「切れたときだけ1回」に置き換えた。アクセストークンの寿命は
 * 1時間なので、朝いちばんの1回だけここを通る（往復が1つ増えるが、そのあとの
 * 全操作から 80ms が消える）。使っている間は Server Action が同じ Cookie を
 * 書けるので、押しているうちは自然に更新される。
 *
 * **Cookie は応答に直接書く。** `lib/supabase/server.ts` の `cookies().set()`
 * でも届くはずだが、ここはセッションそのものを預かる1本道なので、
 * proxy.ts が使っていた「応答に載せる」形をそのまま持ってきてある。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  /**
   * 戻り先。**アプリ内の絶対パスだけ**通す（`//` で始まるものは別のサイト）。
   * auth/callback と同じ判定にしてある。
   */
  const raw = searchParams.get('next');
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  // 戻り先が自分だと往復し続ける。
  const destination = next.startsWith('/auth/refresh') ? '/' : next;

  const written: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          written.push(...cookiesToSet);
        },
      },
    },
  );

  /**
   * `getSession()` は期限が切れていれば更新しに行き、成功すれば上の setAll に
   * 新しい Cookie が渡ってくる。`getUser()` ではなくこちらなのは、**要るのは
   * 更新であって照会ではない**から——照会は Auth への往復がもう1つ増えるだけで、
   * このあと画面側が使うのは Cookie の中身。
   */
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    // 更新トークンも死んでいる（期限切れ・失効・別端末でのログアウト）。
    return NextResponse.redirect(new URL('/login', origin));
  }

  const response = NextResponse.redirect(new URL(destination, origin));
  for (const { name, value, options } of written) {
    response.cookies.set(name, value, options);
  }

  /**
   * **1回だけ試した印**を置く。書いた Cookie が届かなかったときに、ここと画面の
   * あいだで往復し続けるのを止めるため（guard.ts が見る）。30秒で消える
   * ——更新できたトークンは1時間もつので、これで困ることはない。
   */
  response.cookies.set(REFRESHED_COOKIE, '1', {
    maxAge: 30,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: origin.startsWith('https://'),
  });

  return response;
}
