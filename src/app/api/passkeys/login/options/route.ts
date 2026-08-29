import {
  CHALLENGE_COOKIE,
  challengeCookieOptions,
  issueChallenge,
  relyingParty,
} from '@/lib/auth/webauthn';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { cookies } from 'next/headers';

/**
 * ログインするときの引数を作って返す。
 *
 * **allowCredentials を渡さない。** 渡すには「誰がログインしようとしているか」を
 * 先に知る必要があり、それはメールアドレスを打たせるということ。打たせたうえに
 * 「そのアドレスに鍵があるか」を返すと、アドレスの当たり判定にも使われる。
 * residentKey を required にして登録してあるので（register/options）、
 * 端末側が「このサイトの鍵」を覚えていて、選択画面を出してくれる。
 *
 * ここはセッションが無い状態で叩かれる。proxy.ts の matcher から
 * api/passkeys を外してあるのはそのため。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { rpID, origin } = relyingParty(request);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  });

  const challengeId = await issueChallenge(options.challenge, 'authenticate');

  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challengeId, challengeCookieOptions(origin.startsWith('https')));

  return Response.json(options);
}
