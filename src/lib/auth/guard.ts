import { warmDataPath } from '@/lib/supabase/warm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * ログインしていない人を、画面を組み立てる前に追い返す。
 *
 * **これは proxy.ts（middleware）の代わり。** 本番の実測で、Vercel が proxy を
 * 1回起こすだけで **80ms** かかっていた——「proxy だけ通して 307」が 124ms、
 * 「proxy を通らない関数」が 43ms。手元の `next start` では同じ proxy を通しても
 * 静的ファイルと差が無い（15.5ms 対 16.2ms）ので、**中身ではなく器の費用**で、
 * こちらのコードを削っても減らない。器ごと無くすしかない（docs/traps/perf.md）。
 *
 * ここでやるのは3つだけ:
 *
 *   1. セッションの Cookie が**有る**か
 *   2. **期限が切れていない**か
 *   3. 切れていたら `/auth/refresh` へ送る（Cookie を書けるのは Route Handler だけ）
 *
 * **署名の照合はしない。** ここは「ログイン画面へ送るかどうか」を決めるだけの
 * 場所で、読み書きの可否は今までどおり **RLS が決める**（Supabase 側が同じ
 * トークンを自分で検証する）。Cookie を書き換えれば画面の枠までは出せるが、
 * 中身は1行も取れない。**署名の照合をここに足さないこと**——WebCrypto の
 * 検証は温まっていれば速いが、冷えた関数では JWKS を取りに行くので、
 * せっかく先に流している `<head>` がその往復ぶん遅れる。
 *
 * **Server Component からトークンを更新させないこと。** `getClaims()` /
 * `getSession()` は期限が切れていると自分で更新しに行くが、Server Component
 * からは Cookie を書けないので**新しい更新トークンが捨てられる**。更新トークンは
 * 使うたびに回転するので、捨て続けるとセッションごと死ぬ（Supabase の
 * reuse interval を過ぎた時点で、二度と入れなくなる）。だからここでは
 * 期限を**自分で読んで**、切れていたら書ける場所（Route Handler）へ送る。
 */

/** 更新を1回試したことの印。無限に往復しないための歯止め（/auth/refresh が置く）。 */
export const REFRESHED_COOKIE = 'rsstube-refreshed';

/** @supabase/ssr が使う Cookie の名前。長いと `.0` `.1` … に割れる。 */
function sessionCookieName(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ref = new URL(url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

type SessionState = 'live' | 'expired' | 'none';

/**
 * Cookie を読んで、セッションが生きているかだけを見る。
 *
 * 形は @supabase/ssr が決めている: `base64-` + セッションJSON の base64url。
 * 3180文字を超えると `.0` `.1` … に割れるので、番号順に繋いでから読む
 * （`lib/auth/passkey-session.ts` と `scripts/perf-probe.mjs` も同じ形を作っている）。
 * 読めない形のときは「無い」と同じ扱いにする——中途半端に通すより、
 * ログイン画面を出したほうが次にやることが分かる。
 */
export async function sessionState(): Promise<SessionState> {
  const store = await cookies();
  const name = sessionCookieName();

  const chunks: string[] = [];
  const whole = store.get(name)?.value;
  if (whole) {
    chunks.push(whole);
  } else {
    for (let i = 0; ; i++) {
      const part = store.get(`${name}.${i}`)?.value;
      if (part === undefined) break;
      chunks.push(part);
    }
  }
  if (chunks.length === 0) return 'none';

  const raw = chunks.join('');
  if (!raw.startsWith('base64-')) return 'none';

  try {
    const json = Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8');
    const session = JSON.parse(json) as { expires_at?: number };
    if (typeof session.expires_at !== 'number') return 'none';
    // 時計のずれと、この先の描画にかかる時間ぶんだけ早めに切る。
    // ぎりぎりのトークンで描き始めると、途中の問い合わせが 401 で落ちる。
    const SKEW_SEC = 30;
    return session.expires_at * 1000 > Date.now() + SKEW_SEC * 1000 ? 'live' : 'expired';
  } catch {
    return 'none';
  }
}

/**
 * ログインしていなければ、ここで打ち切る（`redirect()` は例外を投げる）。
 *
 * `next` には**戻り先**を渡す。更新のあとにここへ戻すので、記事を開いた URL の
 * まま朝いちばんに開いても、その記事に戻れる。
 *
 * **`<Suspense>` の外（ページの入れ子の手前）で呼ぶこと。** 中で呼ぶと、
 * 骨組みを流し終えたあとの遷移になり、307 ではなく「一度画面を出してから
 * script で飛ばす」形になる。ここは Cookie を読むだけで通信をしないので、
 * 手前に置いても `<head>` の先出しは遅れない。
 */
export async function requireSession(next: string): Promise<void> {
  const state = await sessionState();
  if (state === 'live') return;

  /**
   * **ここまで来た1回は、DB に一度も触らずに終わる**（pg_cron の温めがこれ）。
   *
   * だから次に来るオーナーの1回が「1本目」の重さを払う。本番の実測で、
   * 匿名の直後のログイン済み1本目は **うち DB が 529〜632ms**、2本目以降は
   * 154〜249ms。実機の冷えた起動だと 1218〜1590ms だった。
   * そこで**このインスタンスで1回だけ**、PostgREST へ本物の問い合わせを
   * 通しておく（`lib/supabase/warm.ts`。応答は捨てる）。
   *
   * **素の fetch で `/rest/v1/` を叩くだけの版は効かなかった**ので戻してある。
   * 効いたかどうかは `__rsstubeDataMs` で確かめること。
   */
  warmDataPath();

  if (state === 'expired') {
    const store = await cookies();
    // 更新を1回試したあとにまだ切れているなら、それ以上は往復しない。
    if (!store.get(REFRESHED_COOKIE)) {
      redirect(`/auth/refresh?next=${encodeURIComponent(next)}`);
    }
  }

  redirect('/login');
}
