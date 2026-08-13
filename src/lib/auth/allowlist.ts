/**
 * ログインを許すメールアドレス。
 *
 * ALLOWED_EMAILS にカンマ区切りで書く。空なら制限しない（ローカル開発用）。
 *
 * これは多層防御の内側の1枚でしかないことに注意。
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY はブラウザに配られる公開鍵なので、
 * このアプリを通さず Supabase の auth API を直に叩かれたら、ここは素通りされる。
 * 新規サインアップを本当に止めているのは Supabase 側の設定
 * （Authentication > Sign In / Providers > Allow new users to sign up をオフ）で、
 * こちらは「アプリの入口で意図を明示し、間違って開けたときに気づける」ためのもの。
 */

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string): boolean {
  const list = allowedEmails();
  if (list.length === 0) return true;
  return list.includes(email.trim().toLowerCase());
}
