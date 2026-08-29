import { CHALLENGE_COOKIE, consumeChallenge, relyingParty } from '@/lib/auth/webauthn';
import { signInAsUser } from '@/lib/auth/passkey-session';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { cookies } from 'next/headers';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';

/**
 * 署名を確かめて、通ったらセッションを作る。
 *
 * 鍵を探すのは Secret キーのクライアントから。この時点ではまだ誰でもないので、
 * ログイン中のユーザーとしては passkeys を読めない。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 失敗の文面は1つにする。「その鍵は登録されていない」と返すと、鍵の有無を探れる。 */
const FAILED = 'パスキーで確認できませんでした';

export async function POST(request: Request) {
  const body = (await request.json()) as { response?: AuthenticationResponseJSON };
  if (!body.response) return Response.json({ message: FAILED }, { status: 400 });

  const jar = await cookies();
  const issued = await consumeChallenge(jar.get(CHALLENGE_COOKIE)?.value, 'authenticate');
  jar.delete(CHALLENGE_COOKIE);
  if (!issued) {
    return Response.json({ message: '時間切れです。もう一度お試しください' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: passkey } = await admin
    .from('passkeys')
    .select('id, user_id, credential_id, public_key, counter, transports')
    .eq('credential_id', body.response.id)
    .maybeSingle();

  if (!passkey) return Response.json({ message: FAILED }, { status: 400 });

  // 端末が「誰の鍵か」も返してくる（residentKey で登録したため）。
  // こちらの持ち主と食い違うなら、鍵の対応表がずれている。
  const userHandle = body.response.response.userHandle;
  if (userHandle && userHandle !== passkey.user_id) {
    return Response.json({ message: FAILED }, { status: 400 });
  }

  const { rpID, origin } = relyingParty(request);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: issued.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id as string,
        publicKey: isoBase64URL.toBuffer(passkey.public_key as string),
        counter: Number(passkey.counter),
        transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      },
    });
  } catch {
    return Response.json({ message: FAILED }, { status: 400 });
  }

  if (!verification.verified) return Response.json({ message: FAILED }, { status: 400 });

  // **counter は必ず書き戻す。** 認証器が数えている型のとき、これを止めると
  // 複製された鍵を見分ける手がかりが消える（0 のままの器も多いので、
  // 増えないこと自体は異常ではない）。
  await admin
    .from('passkeys')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', passkey.id);

  try {
    await signInAsUser(passkey.user_id as string);
  } catch (e) {
    // ここから先の失敗は鍵のせいではない（許可アドレスの設定漏れ、Supabase の不調）。
    // 一括りに「確認できませんでした」にすると原因が追えないので、文面を分ける。
    return Response.json(
      { message: e instanceof Error ? e.message : 'ログインできませんでした' },
      { status: 400 },
    );
  }

  return Response.json({ ok: true });
}
