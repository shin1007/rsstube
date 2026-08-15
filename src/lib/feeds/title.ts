/**
 * タイトルに混ざるサイト名・連載名を落とす。
 *
 * 実データで見つけた形:
 *   東洋経済     「本文 | 政治・経済・投資 | 東洋経済オンライン」（75件中75件）
 *   ダイヤモンド 「本文 - ニュースな本」（99件中91件）
 *
 * 一覧でも要約でも音声でも、毎回同じ十数文字が付いて回る。ダイジェストの
 * 読み上げでは特に耳障りになる（8件のうち8件で「東洋経済オンライン」と言う）。
 *
 * **決め手は「繰り返し」。** 区切り文字だけを見て機械的に切ると、
 * 「Magnitude 7.7 Earthquake – 68 km NNW of Ende, Indonesia」のような
 * 本文の一部まで落としてしまう（Hacker News で実際に誤検出した）。
 *
 * そこで、**同じ取得ぶんの中で末尾が揃っているときだけ**落とす。
 * サイト名や連載名は全記事に付くので揃う。記事ごとに違う末尾は揃わないので残る。
 * 1回の取得（10〜100件）の中だけで判断できるので、DB に状態を持たなくてよい。
 */

/** 末尾の切り出しに使う区切り。全角の｜と各種ダッシュを含む。 */
const SEPARATORS = ['|', '｜', ' - ', ' – ', ' — ', '｜'];

/**
 * これ以上落とさない下限。
 *
 * 短いタイトルから末尾を取ると、残りが意味を成さなくなる。
 * 「速報 | NHK」の「速報」だけになるような事故を防ぐ。
 */
const MIN_REMAINING = 8;

/** 末尾として認める長さ。長いものは本文の一部とみなす。 */
const MAX_TAIL = 30;
const MIN_TAIL = 2;

/**
 * 揃っているとみなす割合。
 *
 * 東洋経済のサイト名は100%、ダイヤモンドの連載名は92%。
 * カテゴリ（「政治・経済・投資」など）は記事によって変わるので届かず、残る。
 * ここを下げるとカテゴリまで落ちるが、カテゴリは中身の手がかりなので残したい。
 */
const THRESHOLD = 0.7;

/** 判断に足る件数。少ないと「たまたま揃った」を拾ってしまう。 */
const MIN_SAMPLES = 4;

/** 末尾を1つ切り出す。区切りが無ければ null。 */
function splitTail(title: string): { head: string; tail: string; sep: string } | null {
  let best: { head: string; tail: string; sep: string } | null = null;

  for (const sep of SEPARATORS) {
    const at = title.lastIndexOf(sep);
    if (at <= 0) continue;

    const head = title.slice(0, at).trim();
    const tail = title.slice(at + sep.length).trim();
    if (!head || !tail) continue;
    if (tail.length < MIN_TAIL || tail.length > MAX_TAIL) continue;
    if (head.length < MIN_REMAINING) continue;

    // いちばん後ろで切れたものを採る。区切りが複数あっても末尾は1つ。
    if (!best || at > title.lastIndexOf(best.sep)) best = { head, tail, sep };
  }

  return best;
}

/**
 * 1回の取得ぶんのタイトルから、揃っている末尾を落とす。
 *
 * 入力と同じ並び・同じ件数で返す。落とすものが無ければそのまま返す。
 * 末尾が2段（カテゴリ＋サイト名）でも、揃っているものから順に落ちる。
 */
export function stripRepeatedTails(titles: string[]): string[] {
  if (titles.length < MIN_SAMPLES) return [...titles];

  let current = [...titles];

  // 2段まで。3段以上を落とすと、さすがに元が残らない。
  for (let round = 0; round < 2; round++) {
    const counts = new Map<string, number>();
    const parts = current.map(splitTail);

    for (const p of parts) {
      if (p) counts.set(p.tail, (counts.get(p.tail) ?? 0) + 1);
    }

    let winner: string | null = null;
    for (const [tail, n] of counts) {
      if (n / current.length >= THRESHOLD) winner = tail;
    }
    if (!winner) break;

    current = current.map((title, i) => {
      const p = parts[i];
      return p && p.tail === winner ? p.head : title;
    });
  }

  return current;
}
