import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Google Drive への書き出し。
 *
 * NotebookLM は Drive 上の Google Docs をソースとして直接選べる。`.md` を落として
 * アップロードするより手数が2つ減るので、これが plan.md で「本命」とされていた経路。
 *
 * スコープは drive.file だけ。**このアプリが作ったファイルにしか触れない**ので、
 * 既存のドライブの中身を読む権限は要求しない。フォルダも自分で作ったものを使う。
 *
 * トークンは google_accounts に置く。RLS のポリシーを作っていないので、
 * Secret キーのクライアント（ここ）からしか読めない。
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** 書き出し先のフォルダ名。 */
const FOLDER_NAME = 'RSSTube';

/** 期限のこれだけ手前で取り直す。ネットワークの往復ぶんの余裕。 */
const REFRESH_MARGIN_MS = 60_000;

export type GoogleOAuth = { clientId: string; clientSecret: string };

/**
 * OAuth クライアント。**アプリに1つ**で、ユーザーごとではない
 * （ユーザーごとに持つのは同意の結果＝google_accounts の refresh_token）。
 *
 * app_config（設定画面から入れる）を先に見て、無ければ環境変数へ落ちる。
 * この順なのは、**環境変数はデプロイし直さないと変えられない**ため。
 * 画面から入れた値のほうが新しいはずで、そちらを優先しないと
 * 「入れ直したのに変わらない」ことになる。環境変数を残してあるのは、
 * 既に入れてある手元の `.env.local` をそのまま使えるようにするため。
 *
 * **client_secret を呼び出し側の画面へ返さないこと。** ここは Secret キーの
 * クライアントで読んでいて、app_config には RLS ポリシーが1つも無い（0033）。
 */
export async function googleOAuth(): Promise<GoogleOAuth | null> {
  const db = createAdminClient();
  const { data } = await db
    .from('app_config')
    .select('google_client_id, google_client_secret')
    .maybeSingle();

  const clientId = data?.google_client_id || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = data?.google_client_secret || process.env.GOOGLE_CLIENT_SECRET;

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * 同意のあとに戻ってくる先。**いま開いている URL から組み立てる。**
 *
 * 以前は `GOOGLE_REDIRECT_URI` という環境変数だった。手元と本番で別々に要る値なので、
 * `.env.local`（localhost 向き）を本番へ写すと、同意画面まで行ってから Google 側で
 * redirect_uri_mismatch になる。**こちらのエラーとしては何も戻ってこない**種類の
 * 失敗で、原因が分からない。リクエストから作れば、どこで動かしても必ず揃う。
 *
 * Google Cloud Console の「承認済みのリダイレクト URI」には、この文字列を
 * そのまま登録してもらう（設定画面に出している）。
 */
export function redirectUriFor(request: Request): string {
  return new URL('/api/auth/google/callback', request.url).toString();
}

export type DriveFile = { id: string; url: string; name: string };

type Account = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
  folder_id: string | null;
};

/**
 * 使えるアクセストークンを返す。切れていればリフレッシュトークンで取り直す。
 *
 * リフレッシュトークンは初回の同意のときにしか渡されないので、失効していたら
 * 繋ぎ直してもらうしかない。その場合は接続を消して、画面に出す。
 */
async function accessToken(db: SupabaseClient, account: Account): Promise<string> {
  const stillValid =
    account.access_token &&
    account.expires_at &&
    new Date(account.expires_at).getTime() - REFRESH_MARGIN_MS > Date.now();

  if (stillValid) return account.access_token as string;

  const oauth = await googleOAuth();
  if (!oauth) throw new Error('Google の認証情報が設定されていません');

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // invalid_grant は「取り消された・期限切れ」。繋ぎ直すしかないので消す。
    if (body.includes('invalid_grant')) {
      await db.from('google_accounts').delete().eq('user_id', account.user_id);
      throw new Error('Google の接続が切れています。設定画面から繋ぎ直してください');
    }
    throw new Error(`トークンを取り直せませんでした: ${res.status}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  await db
    .from('google_accounts')
    .update({ access_token: json.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('user_id', account.user_id);

  return json.access_token;
}

/** 書き出し先のフォルダ。無ければ作る。 */
async function ensureFolder(db: SupabaseClient, account: Account, token: string): Promise<string> {
  if (account.folder_id) {
    // 消されていることがあるので、実在を確かめる。
    const check = await fetch(`${DRIVE_FILES}/${account.folder_id}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (check.ok) {
      const f = (await check.json()) as { trashed?: boolean };
      if (!f.trashed) return account.folder_id;
    }
  }

  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw new Error(`フォルダを作れませんでした: ${res.status}`);

  const { id } = (await res.json()) as { id: string };
  await db.from('google_accounts').update({ folder_id: id }).eq('user_id', account.user_id);
  return id;
}

/**
 * Markdown を Google Docs として置く。
 *
 * `text/markdown` で送り、mimeType に Google Docs を指定すると Google 側が変換する。
 * 見出しや箇条書きが Docs の構造になるので、NotebookLM 側の取り込みも素直になる。
 */
export async function uploadToDrive(
  userId: string,
  name: string,
  markdown: string,
): Promise<DriveFile> {
  if (!(await googleOAuth())) {
    throw new Error('Google の認証情報が設定されていません。設定画面から入れてください');
  }

  const db = createAdminClient();
  const { data: account } = await db
    .from('google_accounts')
    .select('user_id, refresh_token, access_token, expires_at, folder_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!account) throw new Error('Google に接続していません。設定画面から接続してください');

  const token = await accessToken(db, account as Account);
  const folderId = await ensureFolder(db, account as Account, token);

  // multipart。1つ目のパートがメタデータ、2つ目が中身。
  const boundary = `rsstube${Date.now()}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    }) +
    `\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n` +
    markdown +
    `\r\n--${boundary}--`;

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Drive に置けませんでした: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const file = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    id: file.id,
    name: file.name,
    url: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
  };
}

/**
 * 接続しているか（画面に出すぶんだけ）。トークンそのものは返さない。
 *
 * `configured` を返すのは、**未設定と未接続が画面で同じに見えていた**ため。
 * どちらも「接続する」ボタンが出るだけで、押すと同意画面にも行かずに
 * 設定画面へ戻ってくる。押す前に理由を出せるように、状態を分けて返す。
 *
 * `clientId` は秘密ではない（同意画面のURLに載る公開値）ので画面に出す。
 * **`clientSecret` は返さない。**入っているかどうかだけを `configured` で伝える。
 */
export async function driveStatus(userId: string): Promise<{
  connected: boolean;
  email?: string;
  configured: boolean;
  clientId?: string;
  /** 環境変数から来ているか。画面では「設定画面の値が優先される」と書き分ける。 */
  fromEnv: boolean;
}> {
  const oauth = await googleOAuth();
  const configured = Boolean(oauth);
  const fromEnv = Boolean(
    oauth && oauth.clientId === process.env.GOOGLE_CLIENT_ID && !(await storedClientId()),
  );

  if (!configured) return { connected: false, configured, fromEnv };

  const db = createAdminClient();
  const { data } = await db
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  return data
    ? { connected: true, email: data.email ?? undefined, configured, clientId: oauth?.clientId, fromEnv }
    : { connected: false, configured, clientId: oauth?.clientId, fromEnv };
}

/** app_config に入っている client_id（無ければ null）。 */
async function storedClientId(): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from('app_config').select('google_client_id').maybeSingle();
  return data?.google_client_id ?? null;
}

/**
 * 認証情報を保存する。設定画面から呼ばれる。
 *
 * **シークレットは空なら触らない。**画面には返していないので、空欄は
 * 「変えない」の意味にしかなり得ない。ここで空文字を書き込むと、
 * 保存ボタンを押しただけで接続が壊れる。
 */
export async function saveGoogleOAuth(clientId: string, clientSecret: string): Promise<void> {
  const db = createAdminClient();
  const patch: Record<string, unknown> = {
    id: true,
    google_client_id: clientId.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (clientSecret.trim()) patch.google_client_secret = clientSecret.trim();

  const { error } = await db.from('app_config').upsert(patch, { onConflict: 'id' });
  if (error) throw error;
}
