import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * マジックリンクの戻り先。
 *
 * 流れ:
 *   1. /login で signInWithOtp → Supabase がメールを送る
 *   2. メールのリンク → Supabase の /auth/v1/verify が検証
 *   3. ここへ ?code=... を付けて戻ってくる
 *   4. code をセッションに交換して Cookie に載せ、/ へ送る
 *
 * @supabase/ssr は PKCE なので 4 が要る。ここが無いと code を持ったまま / に着き、
 * セッションが無いので proxy が /login へ戻し、永久に入れない。
 * proxy.ts の matcher からこのパスを外してあるのも同じ理由（未ログインで来るため）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  // Supabase 側で弾かれた場合はここにエラーが載って戻ってくる（期限切れなど）。
  const error = searchParams.get('error_description') ?? searchParams.get('error');
  // ログイン後の行き先。他サイトへ飛ばされないよう、アプリ内の絶対パスだけ許す。
  const next = searchParams.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));

  if (error) return fail(error);
  if (!code) return fail('ログインリンクが正しくありません。送り直してください。');

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    // よくあるのはリンクの期限切れと、送った端末と開いた端末が違う場合
    // （PKCE の検証用 Cookie が送信元の端末にしか無い）。
    return fail(`${exchangeError.message}（リンクは送った端末で開いてください）`);
  }

  return NextResponse.redirect(new URL(destination, origin));
}
