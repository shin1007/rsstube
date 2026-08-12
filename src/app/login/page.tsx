import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * ログイン画面。
 *
 * 自分専用なのでサインアップ導線は置かない。ユーザーは Supabase の
 * ダッシュボードで1つだけ作り、以後はマジックリンクで入る。
 * （Supabase の Authentication 設定で新規サインアップを無効にしておくこと）
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const error = typeof params.error === 'string' ? params.error : null;

  async function sendMagicLink(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/login?error=' + encodeURIComponent('メールアドレスを入力してください'));

    // メールのリンクから戻ってくる先。localhost と本番で変わるので、
    // 固定値ではなく実際のリクエストのホストから組み立てる。
    // ここで渡した URL は Supabase の Redirect URLs に登録されている必要がある。
    const head = await headers();
    const host = head.get('x-forwarded-host') ?? head.get('host');
    const proto = head.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${proto}://${host}/auth/callback`,
      },
    });

    if (error) redirect('/login?error=' + encodeURIComponent(error.message));
    redirect('/login?sent=1');
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">RSSTube</h1>
        <p className="text-sm text-zinc-400 mb-6">AI要約つきの個人用RSSリーダー</p>

        {sent ? (
          <p className="rounded border border-emerald-800 bg-emerald-950/50 p-3 text-sm">
            ログイン用のリンクをメールで送りました。同じ端末で開いてください。
          </p>
        ) : (
          <form action={sendMagicLink} className="space-y-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="メールアドレス"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-base"
            />
            <button
              type="submit"
              className="w-full rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900"
            >
              ログインリンクを送る
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}
