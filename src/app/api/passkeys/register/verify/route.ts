import { CHALLENGE_COOKIE, consumeChallenge, relyingParty } from '@/lib/auth/webauthn';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { cookies } from 'next/headers';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

/**
 * 認証器が作った公開鍵を検証して保存する。
 *
 * 保存は Secret キーのクライアントから行う。ログイン中のブラウザに insert を
 * 許すと、鍵の中身を自分で書ける＝好きな公開鍵を「登録済み」にできてしまう（0034）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ message: 'ログインしてください' }, { status: 401 });

  const body = (await request.json()) as { response?: RegistrationResponseJSON; label?: string };
  if (!body.response) return Response.json({ message: '登録の内容がありません' }, { status: 400 });

  const jar = await cookies();
  const issued = await consumeChallenge(jar.get(CHALLENGE_COOKIE)?.value, 'register');
  jar.delete(CHALLENGE_COOKIE);

  // 期限切れは失敗として扱うが、文面は分けておく。指紋が読めなかったのか
  // 時間を置きすぎたのかで、次にやることが違う。
  if (!issued) {
    return Response.json({ message: '時間切れです。もう一度お試しください' }, { status: 400 });
  }
  // 出したときの相手と、いま登録しに来た相手が同じか。
  if (issued.userId !== auth.user.id) {
    return Response.json({ message: '登録の相手が変わっています' }, { status: 400 });
  }

  const { rpID, origin } = relyingParty(request);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: issued.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : '確認できませんでした' },
      { status: 400 },
    );
  }

  if (!verification.verified) {
    return Response.json({ message: '確認できませんでした' }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const admin = createAdminClient();
  const { error } = await admin.from('passkeys').insert({
    user_id: auth.user.id,
    credential_id: credential.id,
    // 公開鍵はバイト列で返る。列は text なので base64url にして入れる
    // （JSON にそのまま入れると数字の配列になって、戻すときに崩れる）。
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    // transports はブラウザ側にしか無いことがある。次にこの鍵を出すときの
    // 案内（「USBキーを挿してください」など）に使うだけなので、無ければ空。
    transports: body.response.response.transports ?? credential.transports ?? null,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    label: (body.label ?? '').trim() || null,
  });

  if (error) {
    // 一意制約に当たるのは「同じ鍵をもう一度登録した」とき。
    if (error.code === '23505') {
      return Response.json({ message: 'このパスキーは登録済みです' }, { status: 409 });
    }
    return Response.json({ message: `保存できませんでした: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, backedUp: credentialBackedUp });
}
