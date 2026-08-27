/**
 * 本文が取れなかったとき、もう一度取りに行くか。
 *
 * これまで抽出は1記事につき1回きりだった。`extracted_at` が入った時点で
 * 「処理済み」になり、取れなかった記事は二度と取りに行かない。
 *
 * 本番で失敗している567件を実際に叩き直したら、**3種類に割れた**:
 *
 *   直しようが無い（本文がHTMLに無い）  東洋経済347件。200 は返るが、掴めるのは
 *                                      グローバルメニューだけ
 *   直しようが無い（弾かれている）      Hacker News185件。リンク先が第三者の
 *                                      サイトで 403/401、またはJSでしか描かれない
 *   **取り直せば取れる**                Aeon21件ほか。いま叩くと2万字の本文が返る。
 *                                      取り込んだ直後に一度失敗しただけだった
 *
 * 3つ目のために取り直す。ただし全部を取り直すと、1つ目と2つ目で毎日20件ぶん、
 * 何も変わらないと分かっている取得を繰り返すことになる。**理由で分ける。**
 *
 * ここは DB も fetch も触らない純粋な判定にしてある。閾値や分類をいじったときの
 * 挙動をテストで固定したいのと、ワーカーと調査スクリプトで同じ判断を使うため
 * （`lib/feeds/health.ts` と同じ方針）。
 */

export type ExtractFailure =
  /** 401・403・451 など。相手が意図してこちらを拒んでいる。 */
  | 'blocked'
  /** 404・410。記事が消えたか、URLが違う。 */
  | 'notfound'
  /** 切断・時間切れ・429・5xx。相手の一時的な事情。 */
  | 'network'
  /** HTML が返ってこなかった（PDF など）。 */
  | 'nonhtml'
  /** 取れたが短すぎた（`MIN_CONTENT_CHARS` 未満）。 */
  | 'short'
  /** メニュー・同意画面・エラーページを掴んだ（0016 / 0018 の判定）。 */
  | 'recycled';

/**
 * 取り直す回数の上限。最初の1回を含む。
 *
 * 2 にしてあるのは、取り直しで戻るのが「相手の一時的な事情」だけだから。
 * 6時間空けて駄目なら、3回目も同じ結果になる見込みが高い。
 */
export const MAX_ATTEMPTS = 2;

/**
 * 取り直すまでの間隔。
 *
 * 公開直後に落ちたものが戻る程度には長く、その日のうちに拾える程度には短く。
 * ワーカーは5分毎に回るので、`next_run_at` を過ぎていれば自然に拾われる。
 */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * 例外から理由を決める。
 *
 * `extractArticle` は失敗を Error の文面で返してくる（`HTTP 403 Forbidden` /
 * `HTMLではない (application/pdf)` / fetch の例外）。**文面で分けるのは
 * 気持ちのいいやり方ではない**が、例外の型を増やすより呼び出し側が薄く済む。
 * 文面を変えるときはここも一緒に直すこと。
 */
export function classifyError(err: unknown): ExtractFailure {
  const message = err instanceof Error ? err.message : String(err);

  const status = /^HTTP (\d{3})/.exec(message)?.[1];
  if (status) {
    const code = Number(status);
    if (code === 404 || code === 410) return 'notfound';
    // 429 と 5xx は相手の一時的な事情。あとで戻ることがある。
    if (code === 429 || code >= 500) return 'network';
    return 'blocked';
  }

  if (message.startsWith('HTMLではない')) return 'nonhtml';

  // 時間切れ・DNS・切断。ここが取り直しでいちばん戻る。
  return 'network';
}

/**
 * もう一度取りに行くか。
 *
 * **`blocked` と `notfound` と `nonhtml` と `recycled` は取り直さない。**
 * どれも相手の作りがそのままなら結果が変わらないと分かっている。
 * 東洋経済（recycled）と Hacker News（blocked）で毎日20件ぶん、
 * 何も変わらない取得を繰り返すのを避けるための線引き。
 */
export function shouldRetry(reason: ExtractFailure, attempts: number): boolean {
  if (attempts >= MAX_ATTEMPTS) return false;
  return reason === 'network' || reason === 'short';
}

/** 取り直す時刻。 */
export function retryAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + RETRY_AFTER_MS);
}
