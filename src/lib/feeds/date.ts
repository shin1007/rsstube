/**
 * フィードの日付。
 *
 * **`JST` は JavaScript が解釈できない。** 千葉県のフィードはこう書いてくる:
 *
 *   <pubDate>Wed, 26 Aug 2026 17:00:00 JST</pubDate>
 *
 * `+0900` や `GMT` なら通るが、`JST` は `Invalid Date` になる。RFC 822 が名前で
 * 認めているのは UT / GMT と北米の4つ（EST など）だけで、`JST` はそこに無い。
 * rss-parser も `new Date()` に任せているので、`isoDate` が付かずに落ちる。
 *
 * **静かに壊れる。** 取り込みは成功し、記事も本文も要約も普通に入る。
 * 欠けるのは `published_at` だけで、一覧は `nulls last` で並べるので
 * **その記事が全部リストの末尾に沈む**。実データで千葉県の103件（全体の29%）が
 * この状態だった。「新着なのに一番下にある」としか見えない。
 *
 * ここは fetch も DB も触らない純関数にしてある（`lib/feeds/health.ts` と同じ方針）。
 */

/**
 * 名前で書かれたタイムゾーンの読み替え表。
 *
 * **北米の略号（EST / CST / PDT など）は入れない。** RFC 822 が名前で認めている
 * ぶんは `new Date()` がそのまま読むので、ここに書くと二重になって食い違いのもとになる
 * （実測: `CST` は V8 が -0600 として解釈する）。この表が効くのは
 * **JS が解釈できなかったときだけ**。
 *
 * **曖昧なものも入れない。** `IST` はインド(+0530) / イスラエル(+0200) /
 * アイルランド(+0100) で衝突する。間違った時刻を入れるくらいなら、
 * 日付なしのままのほうがまだ直せる。
 *
 * 増やすときは「その略号が世界で1つに決まるか」を確かめること。
 */
const NAMED_ZONES: Record<string, string> = {
  JST: '+0900',
  JDT: '+0900',
  KST: '+0900',
};

/**
 * フィードの日付文字列を ISO 8601 に直す。
 *
 * @returns 読めなければ undefined（推測で埋めない）
 */
export function parseFeedDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;

  const text = raw.trim();
  if (!text) return undefined;

  const direct = toIso(text);
  if (direct) return direct;

  // 末尾が名前のタイムゾーンなら、数字のオフセットに置き換えてもう一度。
  const named = /\s([A-Z]{2,5})$/.exec(text);
  const offset = named && NAMED_ZONES[named[1]];
  if (offset) return toIso(`${text.slice(0, named.index)} ${offset}`);

  return undefined;
}

function toIso(text: string): string | undefined {
  const t = new Date(text).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
