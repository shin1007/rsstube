/**
 * フィードの健康状態。
 *
 * 死に方は3通りあって、見え方が違う:
 *
 *   取得に失敗する    error_count が積み上がる。404・DNS切れ・タイムアウト
 *   更新が止まる      取得は 200 で成功し続けるので失敗回数は 0 のまま。
 *                     サイトが更新をやめただけなので、こちらからは区別できない
 *   本文が取れない    フィードも記事も正常に取れているのに、記事URLから本文を
 *                     抜けない。要約が RSS の抜粋だけから作られる（0028）
 *
 * 2つ目は放っておくと購読一覧に居座り続ける。巡回のたびに条件付きGETが1回走るだけなので
 * 実害は小さいが、「読むものが減った」ときに原因が分からなくなる。
 *
 * 3つ目は**どの数字にも出ない**のがたちが悪い。error_count は 0、新着も毎日ある。
 * 実データでは東洋経済が427件中347件（81%）で本文を取れておらず、それでも
 * 設定画面には何も出ていなかった。読み手には「要約が薄い」としか見えない。
 *
 * ここは DB を触らない純粋な判定にしてある。閾値をいじったときの挙動を
 * テストで固定したいのと、表示側とワーカー側の両方から同じ判断を使うため。
 */

export type FeedHealth = {
  level: 'ok' | 'stale' | 'undated' | 'unreadable' | 'failing' | 'dead';
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
  /** 直近60日で本文を取りに行った記事の数（`feed_content_stats()`）。 */
  extracted?: number;
  /** そのうち本文を取れなかった数。 */
  unreadable?: number;
  /** 直近60日に取り込んだ記事のうち、日付が入っていない数（`0030`）。 */
  undated?: number;
  /** 直近60日に取り込んだ記事の数。undated の母数。 */
  ingested?: number;
};

/** これだけ連続で失敗していたら、一時的な不調ではなく壊れているとみなす。 */
const DEAD_ERRORS = 10;
/** 数回の失敗は珍しくない（相手の一時的な不調）。ここから「不調」として出す。 */
const FAILING_ERRORS = 3;

/** これだけ新着が無ければ「更新が止まっている」とみなす。 */
const STALE_DAYS = 60;

/**
 * 本文を取れない記事がこの割合を超えたら知らせる。
 *
 * 実データの分かれ方がはっきりしていたので、間を取った位置に置いてある:
 * 東洋経済 81% / Hacker News 16% / それ以外は 1% 以下。
 * 半分を超えていれば「たまに失敗する」ではなく「このフィードは読めない」。
 */
const UNREADABLE_RATIO = 0.5;

/**
 * 割合を見る前に要る件数。
 *
 * 3件中2件で「81%が読めません」と出すと、購読したてのフィードが
 * ほぼ必ず引っかかる。
 */
const UNREADABLE_MIN_ARTICLES = 10;

/**
 * 日付なしがこの割合を超えたら知らせる。
 *
 * 半分にしないのは、日付を打たない項目が混ざるフィードが普通にあるため
 * （鎌ケ谷市は8件が同じ 00:00 で入っている）。「ほぼ全部に無い」ときだけ出す。
 */
const UNDATED_RATIO = 0.8;

/** 割合を見る前に要る件数。少数の取りこぼしで騒がないため。 */
const UNDATED_MIN_ARTICLES = 10;
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

  // 取得も更新も正常なのに、記事の本文だけが取れないフィード。
  // 数字にも画面にも出ないまま、要約だけが薄くなる。
  const extracted = feed.extracted ?? 0;
  const unreadable = feed.unreadable ?? 0;
  if (extracted >= UNREADABLE_MIN_ARTICLES && unreadable / extracted >= UNREADABLE_RATIO) {
    return {
      level: 'unreadable',
      reason:
        `直近60日の${extracted}件のうち${unreadable}件で本文を取れていません` +
        `（${Math.round((unreadable / extracted) * 100)}%）。` +
        `要約はRSSの抜粋だけから作られます。ペイウォールかボット対策なので、こちら側では直せません`,
    };
  }

  // 日付が入っていない記事。取得も本文も要約も正常なので、どの数字にも出ない。
  // 一覧は nulls last で並べるので、その記事は末尾に沈む——見ている側には
  // 「新着が来ていない」としか映らない（千葉県の103件がそうだった）。
  const ingested = feed.ingested ?? 0;
  const undated = feed.undated ?? 0;
  if (ingested >= UNDATED_MIN_ARTICLES && undated / ingested >= UNDATED_RATIO) {
    return {
      level: 'undated',
      reason:
        `直近60日の${ingested}件のうち${undated}件に日付が入っていません。` +
        `一覧の末尾に沈むので新着に気づけません。` +
        `フィードが規格外のタイムゾーン名を使っている可能性があります（lib/feeds/date.ts）`,
    };
  }

  return { level: 'ok', reason: '' };
}

/** 手当てが要るものだけ。表示の並びもここで決める（重いものが上）。 */
export function needsAttention<T extends FeedHealthInput>(
  feeds: T[],
  now = Date.now(),
): { feed: T; health: FeedHealth }[] {
  // 重いものが上。読めないフィードは「更新なし」より手当ての価値がある
  // （毎日記事が来るのに、その全部が薄いままなので）。
  const order = { dead: 0, failing: 1, unreadable: 2, undated: 3, stale: 4, ok: 5 };

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
