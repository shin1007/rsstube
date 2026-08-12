import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * .env.local から接続情報を組み立てて Postgres に繋ぐ。
 *
 * .env.local を丸ごと読み込む形にはしない。値に空白や # が混じると
 * 解釈がそこで壊れて後ろの変数が黙って空になる（実際に一度やらかした）。
 * 必要な行だけを素直に拾う。
 */

const ENV_FILE = process.env.ENV_FILE ?? '.env.local';

function readEnv(name) {
  let text;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new Error(`${ENV_FILE} がありません。`);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`${name}=`)) continue;
    // 値に = が含まれていても壊れないよう、最初の = より後ろを全部取る。
    return line.slice(name.length + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return '';
}

/** ダッシュボードの URI はパスワードが [YOUR-PASSWORD] のままなので、別に貰って埋める。 */
export function connectionString() {
  const url = readEnv('SUPABASE_DB_URL');
  const password = readEnv('SUPABASE_DB_PASSWORD');

  if (!url) {
    throw new Error(
      'SUPABASE_DB_URL が .env.local にありません。\n' +
        'ダッシュボード上部の「Connect」ボタン > Session pooler の1行を貼ってください。',
    );
  }

  if (!password) {
    if (url.includes('[YOUR-PASSWORD]')) {
      throw new Error('SUPABASE_DB_PASSWORD に実際のパスワードを書いてください。');
    }
    return url;
  }

  // URL のパスワード部分だけを差し替える。encodeURIComponent が記号を処理するので
  // 利用者はエンコードを気にしなくてよい。
  const parsed = new URL(url);
  parsed.password = password;
  return parsed.toString();
}

/**
 * 接続する。Supabase は SSL 必須。証明書の検証をまず有効で試し、
 * 検証に失敗する構成なら警告を出したうえで検証なしに落とす。
 */
export async function connect() {
  const connectionStringValue = connectionString();

  for (const [label, ssl] of [
    ['検証あり', { rejectUnauthorized: true }],
    ['検証なし', { rejectUnauthorized: false }],
  ]) {
    const client = new pg.Client({ connectionString: connectionStringValue, ssl });
    try {
      await client.connect();
      if (label === '検証なし') {
        console.warn('警告: TLS証明書の検証に失敗したため、検証なしで接続しました。');
      }
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      const isCertError = /certificate|self[- ]signed|CERT_/i.test(String(err?.message ?? ''));
      if (label === '検証あり' && isCertError) continue;
      throw err;
    }
  }

  throw new Error('接続できませんでした。');
}
