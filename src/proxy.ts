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

  /**
   * ログインしているかを**手元で**確かめる。
   *
   * ここは全ページの前に必ず通る。`getUser()` は Supabase の Auth に
   * 毎回聞きに行くので、その1往復が**すべての画面遷移に丸ごと乗る**。
   * 実測（本番・東京、ログイン済みで /login を叩いて 307 だけ返させた形＝
   * ページ描画ゼロ）で 250ms。記事を開く1回が 570ms なので、**待ち時間の
   * 4割強がここ**だった。
   *
   * `getClaims()` は同じ検証を WebCrypto でその場でやる。このプロジェクトの
   * 署名鍵は ES256（非対称）なので、公開鍵さえ持っていれば通信は要らない
   * ——鍵は JWKS を1回取って**プロセスに残る**（auth-js の GLOBAL_JWKS）ので、
   * 温まった関数では往復ゼロ。冷えた1回目だけ取りに行く。
   *
   * 検証を緩めたわけではない。`getSession()` を直に見るのとは違い、署名を
   * 実際に照合して `exp` も見る（Cookie を書き換えても通らない）。対称鍵の
   * プロジェクトや WebCrypto の無い環境では、auth-js が自分で `getUser()` に
   * 落ちる。トークンの更新も従来どおり——期限が近ければ getClaims の中の
   * getSession が先に更新し、上の setAll が新しい Cookie を書く。
   *
   * Supabase に到達できないときは「未ログイン」として扱う（開けてしまうより安全）。
   */
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub ?? null;
  } catch {
    userId = null;
  }

  const isAuthPage = request.nextUrl.pathname.startsWith('/login');
  const isDebugPage = request.nextUrl.pathname.startsWith('/api/debug');
  if (!userId && !isAuthPage && !isDebugPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (userId && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的ファイルと、シークレットで別途保護している cron/ワーカー/診断は対象外。
     * matcher を書かないと CSS や画像まで認証にかかる。
     *
     * auth/ も外す。マジックリンクのコールバックは「まだセッションが無い状態」で
     * 来るので、ここを通すと /login へ弾かれてログインが成立しない。
     *
     * PWA の3点（manifest / sw.js / offline.html）も外す。ここを認証にかけると、
     * 未ログインだとインストール要件を満たせず、圏外のときは offline.html 自体が
     * /login へのリダイレクトになって何も出せなくなる。
     *
     * api/passkeys も外す。**パスキーでのログインはセッションが無い状態で始まる**ので、
     * ここで弾くと POST が /login への 307 に化けて、ブラウザには JSON の代わりに
     * HTML が返る（「予期しないトークン '<'」としか出ない）。
     * 登録側の2本はセッションが要るが、その確認は各ルートが自分でやっている。
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|auth|api/cron|api/jobs|api/debug|api/passkeys|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
