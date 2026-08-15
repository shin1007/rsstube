import { isAllowedEmail } from '@/lib/auth/allowlist';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * ログイン画面。
 *
 * 自分専用なのでサインアップ導線は置かない。ユーザーは Supabase の
 * ダッシュボードで1つだけ作り、以後はメールアドレスとパスワードで入る。
 *
 * マジックリンクから替えた理由: スマホで毎回メールアプリへ行き来するのが面倒なうえ、
 * PKCE の都合で**リンクを送ったブラウザと同じブラウザで開かないと失敗する**。
 * メールアプリがアプリ内ブラウザで開くと、それだけで入れなくなる。
 * パスワードなら1画面で完結し、パスワードマネージャに任せられる。
 *
 * メールは初回のパスワード設定と、忘れたときの再設定にだけ使う。
 *
 * 新規作成を止めているのは3枚:
 *   1. この画面にサインアップ導線を置かない
 *   2. ALLOWED_EMAILS               書いてあるアドレス以外には再設定メールも送らない
 *   3. Supabase の「Allow new users to sign up」をオフ  ← これが本丸
 * 1と2はアプリを通った場合にしか効かない。公開鍵で auth API を直接叩かれる経路は
 * 3でしか塞げない。**パスワードにしたぶん、3の重みは増している**
 * （リンクを踏ませる手間すら要らずにアカウントを作られる）。
 */

/** これ未満は受け付けない。Supabase 側の既定（6）より少し厳しくする。 */
const MIN_PASSWORD = 8;

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const error = typeof params.error === 'string' ? params.error : null;

  async function signIn(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) {
      redirect('/login?error=' + encodeURIComponent('メールアドレスとパスワードを入力してください'));
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    // 「登録済みかどうか」を教えないよう、原因は区別せず同じ文面にする。
    if (error) {
      redirect('/login?error=' + encodeURIComponent('メールアドレスかパスワードが違います'));
    }

    redirect('/');
  }

  /** 初回の設定と、忘れたときの再設定。ここだけメールを使う。 */
  async function sendReset(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/login?error=' + encodeURIComponent('メールアドレスを入力してください'));

    // 許可していないアドレスには送らない。文面は成功時と区別しない。
    if (!isAllowedEmail(email)) redirect('/login?sent=1');

    // 戻り先は localhost と本番で変わるので、実際のリクエストのホストから組み立てる。
    // ここで渡す URL は Supabase の Redirect URLs に登録されている必要がある。
    const head = await headers();
    const host = head.get('x-forwarded-host') ?? head.get('host');
    const proto = head.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');

    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${proto}://${host}/auth/callback?next=/account/password`,
    });

    // 送れたかどうかも伏せる（存在しないアドレスを試されたときに差が出ないように）。
    redirect('/login?sent=1');
  }

  return (
    // body が高さを固定したので、ここが自分でスクロールする必要がある。
    // 画面の低い端末で入力欄にキーボードが被ったときに動かせなくなるため。
    <main className="flex-1 overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">RSSTube</h1>
        <p className="text-sm text-zinc-400 mb-6">AI要約つきの個人用RSSリーダー</p>

        {sent ? (
          <p className="rounded border border-emerald-800 bg-emerald-950/50 p-3 text-sm">
            パスワード設定用のリンクをメールで送りました。
            開いてパスワードを決めると、次からはこの画面で入れます。
          </p>
        ) : (
          // フォームは1つ。再設定も同じ入力欄のメールアドレスを使うので、
          // 分けると打ち直しになる。ボタンごとに formAction で送り先を変える。
          <form action={signIn} className="space-y-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              placeholder="メールアドレス"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-base"
            />
            <input
              type="password"
              name="password"
              required
              minLength={MIN_PASSWORD}
              autoComplete="current-password"
              placeholder="パスワード"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-base"
            />
            <button
              type="submit"
              className="w-full rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-900"
            >
              ログイン
            </button>

            {/* 初回はパスワードが無いので、まずここから設定する。
                formNoValidate を付けるのは、パスワード欄が空でも送れるようにするため。 */}
            <div className="border-t border-zinc-800 pt-4">
              <p className="mb-2 text-xs text-zinc-500">
                はじめて使うとき、またはパスワードを忘れたときは、メールアドレスだけ入れて
                こちらを押してください。設定用のリンクを送ります。
              </p>
              <button
                type="submit"
                formAction={sendReset}
                formNoValidate
                className="text-xs text-zinc-400 underline hover:text-zinc-200"
              >
                パスワードを設定・再設定する
              </button>
            </div>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}
