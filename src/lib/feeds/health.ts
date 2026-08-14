/**
 * フィードの健康状態。
 *
 * 死に方は2通りあって、見え方が違う:
 *
 *   取得に失敗する    error_count が積み上がる。404・DNS切れ・タイムアウト
 *   更新が止まる      取得は 200 で成功し続けるので失敗回数は 0 のまま。
 *                     サイトが更新をやめただけなので、こちらからは区別できない
 *
 * 後者は放っておくと購読一覧に居座り続ける。巡回のたびに条件付きGETが1回走るだけなので
 * 実害は小さいが、「読むものが減った」ときに原因が分からなくなる。
 *
 * ここは DB を触らない純粋な判定にしてある。閾値をいじったときの挙動を
 * テストで固定したいのと、表示側とワーカー側の両方から同じ判断を使うため。
 */

export type FeedHealth = {
  level: 'ok' | 'stale' | 'failing' | 'dead';
  /** 画面に出す一言。level だけだと何をすればいいか分からない。 */
  reason: string;
};

export type FeedHealthInput = {
  errorCount: number;
  lastError?: string | null;
  /** 最後に新しい記事が入った時刻。null は1件も無い。 */
  lastArticleAt?: string | null;
  /** 購読した時刻。登録直後に「更新が止まっている」と言わないために要る。 */
  createdAt?: string | null;
};

/** これだけ連続で失敗していたら、一時的な不調ではなく壊れているとみなす。 */
const DEAD_ERRORS = 10;
/** 数回の失敗は珍しくない（相手の一時的な不調）。ここから「不調」として出す。 */
const FAILING_ERRORS = 3;

/** これだけ新着が無ければ「更新が止まっている」とみなす。 */
const STALE_DAYS = 60;
/** 登録からこの日数は、記事が来なくても様子を見る。 */
const GRACE_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

export function classifyFeed(feed: FeedHealthInput, now = Date.now()): FeedHealth {
  // 取得できていないほうが重い。読めなければ更新の有無は分からない。
  if (feed.errorCount >= DEAD_ERRORS) {
    return {
      level: 'dead',
      reason: `${feed.errorCount}回続けて取得に失敗しています。URLが変わったか、配信が終わった可能性があります`,
    };
  }

  if (feed.errorCount >= FAILING_ERRORS) {
    return {
      level: 'failing',
      reason: `${feed.errorCount}回続けて取得に失敗しています${feed.lastError ? `（${feed.lastError.slice(0, 60)}）` : ''}`,
    };
  }

  const age = daysSince(feed.lastArticleAt, now);

  // 記事が1件も無い場合は、登録したばかりかどうかで見方を変える。
  if (age === null) {
    const since = daysSince(feed.createdAt, now);
    if (since !== null && since >= GRACE_DAYS) {
      return { level: 'stale', reason: `登録してから${since}日、記事が1件も入っていません` };
    }
    return { level: 'ok', reason: '' };
  }

  if (age >= STALE_DAYS) {
    return {
      level: 'stale',
      reason: `${age}日、新しい記事が来ていません。取得自体は成功しています`,
    };
  }

  return { level: 'ok', reason: '' };
}

/** 手当てが要るものだけ。表示の並びもここで決める（重いものが上）。 */
export function needsAttention<T extends FeedHealthInput>(
  feeds: T[],
  now = Date.now(),
): { feed: T; health: FeedHealth }[] {
  const order = { dead: 0, failing: 1, stale: 2, ok: 3 };

  return feeds
    .map((feed) => ({ feed, health: classifyFeed(feed, now) }))
    .filter((r) => r.health.level !== 'ok')
    .sort((a, b) => order[a.health.level] - order[b.health.level]);
}

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY);
}
