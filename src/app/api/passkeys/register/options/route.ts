import {
  CHALLENGE_COOKIE,
  RP_NAME,
  challengeCookieOptions,
  issueChallenge,
  relyingParty,
} from '@/lib/auth/webauthn';
import { createClient } from '@/lib/supabase/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { cookies } from 'next/headers';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

/**
 * パスキーを登録するときの引数を作って返す。
 *
 * 登録はログイン中にしかできない。「いまブラウザにセッションがある人」が
 * 「この端末を今後の合鍵にする」と言っているだけなので、パスワードで一度入れた
 * 状態が前提になる。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ message: 'ログインしてください' }, { status: 401 });

  const { rpID, origin } = relyingParty(request);

  // 既に登録済みの鍵を渡すと、同じ端末で二重に作られない
  // （認証器が「もう登録されています」と言ってくれる）。
  const { data: existing } = await supabase
    .from('passkeys')
    .select('credential_id, transports')
    .eq('user_id', auth.user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    // ユーザーの見分けは Supabase の id で固定する。**毎回変えないこと。**
    // 変えると同じ端末に鍵が積み上がり、選択画面に同じ名前が並ぶ。
    userID: new TextEncoder().encode(auth.user.id),
    userName: auth.user.email ?? 'rsstube',
    userDisplayName: auth.user.email ?? 'RSSTube',
    // 素性の証明書は要らない。個人用なので、どのメーカーの器かを問わない。
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((k) => ({
      id: k.credential_id as string,
      transports: (k.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      // **residentKey は required。** 端末の中に「誰の鍵か」まで持たせないと、
      // ログイン画面でメールアドレスを打たずに選べない（それがやりたいこと）。
      residentKey: 'required',
      // 生体認証か PIN を必ず通す。パスキーだけで入れる以上、
      // 端末を拾った人がそのまま入れては困る。
      userVerification: 'required',
    },
  });

  const challengeId = await issueChallenge(options.challenge, 'register', auth.user.id);

  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challengeId, challengeCookieOptions(origin.startsWith('https')));

  return Response.json(options);
}
