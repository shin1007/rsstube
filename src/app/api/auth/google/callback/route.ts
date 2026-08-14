import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Google から戻ってくるところ。
 *
 * 認可コードをトークンに交換して置く。リフレッシュトークンは**このときにしか
 * 渡されない**ので、取りこぼすと繋ぎ直しになる。
 *
 * 書き込みは Secret キーのクライアントで行う。google_accounts は RLS の
 * ポリシーを1つも作っていないので、本人のセッションからは触れない（意図的）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function back(request: Request, status: string) {
  const url = new URL('/settings', request.url);
  url.searchParams.set('drive', status);
  return Response.redirect(url, 303);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.redirect(new URL('/login', request.url));

  const params = new URL(request.url).searchParams;
  if (params.get('error')) return back(request, 'denied');

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return back(request, 'failed');

  // 送り出したときに置いた Cookie と一致するか。よそから踏ませても通らないように。
  const cookie = request.headers.get('cookie') ?? '';
  const expected = /rsstube_google_state=([a-f0-9]+)/.exec(cookie)?.[1];
  if (!expected || expected !== state) return back(request, 'state');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) return back(request, 'failed');

  const token = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };

  // これが無いと、こちらの都合でトークンを取り直せない＝自動書き出しができない。
  if (!token.refresh_token) return back(request, 'no-refresh');

  // どのアカウントに繋いだかを画面に出すため、id_token からメールだけ取り出す。
  // 署名は検証しない。Google から直接受け取った応答で、表示にしか使わないため。
  let email: string | null = null;
  if (token.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.id_token.split('.')[1], 'base64url').toString('utf8'),
      ) as { email?: string };
      email = payload.email ?? null;
    } catch {
      // 取れなくても接続そのものには影響しない。
    }
  }

  const db = createAdminClient();
  const { error } = await db.from('google_accounts').upsert(
    {
      user_id: auth.user.id,
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return back(request, 'failed');

  // 役目を終えた state の Cookie は消す。
  const redirect = back(request, 'connected');
  return new Response(null, {
    status: 303,
    headers: {
      Location: redirect.headers.get('Location') ?? '/settings',
      'Set-Cookie': 'rsstube_google_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    },
  });
}
