import { unstable_rethrow } from 'next/navigation';

/**
 * Server Action の結果。
 *
 * **本番では throw したエラーの中身が表に出ない。** Next はサーバー側の例外を
 * digest に置き換えるので、クライアントに届くのは「Minified React error #441」
 * （中身を伏せた Server Components のエラー）だけになる。
 * つまり `throw new Error('フィードを読めませんでした')` と書いても、
 * その文面は本番で一度も表示されない——設定の保存ボタンでは、失敗しても
 * 「押しても何も起きない」ようにしか見えなかった。
 *
 * 見せたい文面は値として返すこと。押した人に伝わらない失敗は、
 * 起きていないのと同じに見える。
 */

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; message: string };

/**
 * 中で投げられたエラーを文面に変えて返す。
 *
 * 既存の `throw new Error('…')` をそのまま活かせるようにしてある
 * （中の書き方を変えずに、外向きの契約だけ差し替えられる）。
 * 中身はサーバーのログにも残す。表に出す一文だけでは後から追えない。
 */
export async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    // **redirect() と notFound() は throw で動く。** ここで飲み込むと、
    // 画面遷移が「失敗しました」という文字列に化けて、どこにも移らなくなる。
    // Next が用意している判定に任せて、制御用のものだけ投げ直す。
    unstable_rethrow(e);

    console.error('server action failed', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * クライアント側で catch したときに出す文面。
 *
 * ここに来るのは通信断か、Server Action の外側で落ちたとき。どちらも
 * 中身は本番では伏せられているので、原因を推測した文章は書かない。
 */
export const UNEXPECTED_ERROR = '通信できませんでした。少し待ってからもう一度お試しください。';
