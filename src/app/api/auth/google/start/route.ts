import { driveConfigured } from '@/lib/export/drive';
import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

/**
 * Google の同意画面へ送り出す。
 *
 * スコープは drive.file だけ。**このアプリが作ったファイルにしか触れない**ので、
 * 既存のドライブを読む権限は要求しない。NotebookLM に渡すファイルを置くだけなら
 * これで足りる。
 *
 * access_type=offline と prompt=consent を付けるのは、リフレッシュトークンを
 * 確実に受け取るため。2回目以降は既に同意済みだと返ってこないことがあり、
 * それだと毎朝の自動書き出しができない。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.redirect(new URL('/login', request.url));

  if (!driveConfigured()) {
    return Response.redirect(new URL('/settings?drive=unconfigured', request.url));
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!redirectUri) {
    return Response.redirect(new URL('/settings?drive=unconfigured', request.url));
  }

  // 戻ってきたときに「こちらが送り出したもの」だと確かめるための値。
  // Cookie と突き合わせるので、URL だけ見て偽装できない。
  const state = randomBytes(16).toString('hex');

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file email');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `rsstube_google_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`,
    },
  });
}
