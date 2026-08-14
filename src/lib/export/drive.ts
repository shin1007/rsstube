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

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
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

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
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
  if (!driveConfigured()) throw new Error('Google の認証情報が設定されていません');

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

/** 接続しているか（画面に出すぶんだけ）。トークンそのものは返さない。 */
export async function driveStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
  if (!driveConfigured()) return { connected: false };

  const db = createAdminClient();
  const { data } = await db
    .from('google_accounts')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();

  return data ? { connected: true, email: data.email ?? undefined } : { connected: false };
}
