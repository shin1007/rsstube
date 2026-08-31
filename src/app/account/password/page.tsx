import { PasswordField } from '@/components/PasswordField';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * パスワードの設定・変更。
 *
 * 入口は2つ:
 *   - ログイン画面の「パスワードを設定・再設定する」→ メールのリンク →
 *     /auth/callback がセッションを作ってここへ送る
 *   - ログイン済みで、あとから変えたくなったとき（設定画面からのリンク）
 *
 * どちらもセッションがある前提。無ければ proxy が /login へ返す。
 */

export const dynamic = 'force-dynamic';

/** ログイン画面と揃えること。 */
const MIN_PASSWORD = 8;

export default async function PasswordPage({ searchParams }: PageProps<'/account/password'>) {
  const params = await searchParams;
  const done = params.done === '1';
  const error = typeof params.error === 'string' ? params.error : null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  async function save(formData: FormData) {
    'use server';

    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (password.length < MIN_PASSWORD) {
      redirect(
        '/account/password?error=' +
          encodeURIComponent(`パスワードは${MIN_PASSWORD}文字以上にしてください`),
      );
    }
    // 打ち間違いに気づけないと、次から入れなくなる。
    if (password !== confirm) {
      redirect('/account/password?error=' + encodeURIComponent('確認用と一致しません'));
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      redirect('/account/password?error=' + encodeURIComponent(error.message));
    }

    redirect('/account/password?done=1');
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-sm space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="text-sm text-zinc-400">
            ← 設定
          </Link>
          <h1 className="text-xl font-bold">パスワード</h1>
        </div>

        <p className="text-xs text-zinc-500">
          {auth.user.email} のパスワードを決めます。次からはこのパスワードでログインします。
        </p>

        {done ? (
          <div className="space-y-3">
            <p className="rounded border border-emerald-800 bg-emerald-950/50 p-3 text-sm">
              設定しました。
            </p>
            <Link href="/" className="text-sm text-zinc-400 underline">
              一覧へ
            </Link>
          </div>
        ) : (
          <form action={save} className="space-y-3">
            {/* ここも伏せた状態で開く。**打ち間違いは確認欄で受け止める。**
                パスワード欄が最初から読める画面は世の中に無く、見慣れない形は
                それだけで「安全でない」と読まれる。見たいときは「見る」を押す。 */}
            <PasswordField
              name="password"
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              placeholder={`新しいパスワード（${MIN_PASSWORD}文字以上）`}
            />
            <PasswordField
              name="confirm"
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              placeholder="確認のためもう一度"
            />
            <button
              type="submit"
              className="w-full rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900"
            >
              設定する
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}
