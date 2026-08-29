import { createAdminClient } from '@/lib/supabase/admin';

/**
 * パスキー（WebAuthn）の土台。
 *
 * ここに置くのは「どのドメインの鍵か」と「チャレンジの出し入れ」だけ。
 * 署名の検証そのものは @simplewebauthn/server に任せる（自前で書く部分ではない）。
 */

/** アプリの名前。認証器の画面と、OS のパスワード管理に出る。 */
export const RP_NAME = 'RSSTube';

/** チャレンジの寿命。ブラウザ側の timeout（60秒）より少しだけ長く取る。 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * リクエストから origin と rpID を作る。
 *
 * **環境変数に書かないこと。** localhost・Vercel のプレビュー・本番でドメインが
 * 変わるのに、値は1つしか置けない。食い違うと「ドメインが違う」という理由で
 * ブラウザが黙って弾く（`NotAllowedError` としか出ないので原因が読めない）。
 * Google の redirect_uri と同じ考えかたで、いま開いている URL から組み立てる。
 *
 * ただし**鍵はドメインに紐づく**ので、本番で登録したパスキーはプレビュー用の
 * ドメインでは使えない。これは仕様であって、こちらで直せるものではない。
 */
export function relyingParty(request: Request): { origin: string; rpID: string } {
  const headers = request.headers;
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto =
    headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  // rpID はポートを含まない「ドメインだけ」。origin のほうはポートまで含む。
  // ここを取り違えると検証が必ず落ちる。
  const rpID = host.split(':')[0];

  return { origin: `${proto}://${host}`, rpID };
}

/**
 * 出したチャレンジを控える。
 *
 * 戻り値はその行の id で、Cookie に入れて持ち回る。**チャレンジそのものを
 * Cookie に入れない**のは、あとで「こちらが出したもの」だと言えなくなるため
 * （0034 のコメント）。
 */
export async function issueChallenge(
  challenge: string,
  kind: 'register' | 'authenticate',
  userId?: string,
): Promise<string> {
  const admin = createAdminClient();

  // 使われなかったぶんが残り続けるので、出すついでに古いものを流す。
  // 掃除だけの cron を足すほどの量ではない。
  await admin
    .from('webauthn_challenges')
    .delete()
    .lt('created_at', new Date(Date.now() - CHALLENGE_TTL_MS).toISOString());

  const { data, error } = await admin
    .from('webauthn_challenges')
    .insert({ challenge, kind, user_id: userId ?? null })
    .select('id')
    .single();

  if (error) throw new Error(`チャレンジを保存できませんでした: ${error.message}`);
  return data.id as string;
}

/**
 * 控えたチャレンジを取り出して、その場で消す。
 *
 * **必ず消すこと。** 残すと同じ署名を二度通せる（それを防ぐための乱数なので、
 * 使い回せた時点で意味が無くなる）。期限切れも「無かった」として扱う。
 */
export async function consumeChallenge(
  id: string | undefined,
  kind: 'register' | 'authenticate',
): Promise<{ challenge: string; userId: string | null } | null> {
  if (!id) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from('webauthn_challenges')
    .select('challenge, kind, user_id, created_at')
    .eq('id', id)
    .maybeSingle();

  // 取れても取れなくても消す。失敗したチャレンジを再挑戦に使わせない。
  await admin.from('webauthn_challenges').delete().eq('id', id);

  if (!data) return null;
  // 登録用のチャレンジをログインの検証に持ち込ませない。
  if (data.kind !== kind) return null;
  if (Date.now() - new Date(data.created_at as string).getTime() > CHALLENGE_TTL_MS) return null;

  return { challenge: data.challenge as string, userId: (data.user_id as string | null) ?? null };
}

/** チャレンジの行 id を入れる Cookie。 */
export const CHALLENGE_COOKIE = 'webauthn_challenge';

export function challengeCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}
