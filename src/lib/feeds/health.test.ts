import { describe, expect, it } from 'vitest';
import { classifyFeed, needsAttention } from './health';

const NOW = new Date('2026-08-14T00:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('classifyFeed', () => {
  it('取得できていて新着もあれば ok', () => {
    expect(classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(1) }, NOW).level).toBe('ok');
  });

  it('数回の失敗はまだ ok（相手の一時的な不調）', () => {
    // ここで騒ぐと、たまたま落ちていただけのフィードで毎回警告が出る。
    expect(classifyFeed({ errorCount: 2, lastArticleAt: daysAgo(1) }, NOW).level).toBe('ok');
  });

  it('3回続けて失敗したら不調', () => {
    const h = classifyFeed({ errorCount: 3, lastArticleAt: daysAgo(1) }, NOW);
    expect(h.level).toBe('failing');
    expect(h.reason).toContain('3回');
  });

  it('10回続けて失敗したら壊れている扱い', () => {
    expect(classifyFeed({ errorCount: 10, lastArticleAt: daysAgo(1) }, NOW).level).toBe('dead');
  });

  it('取得できていても新着が60日無ければ stale', () => {
    // 実データの MDN Blog がこれだった。失敗回数は0なので、これが無いと気づけない。
    const h = classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(60) }, NOW);
    expect(h.level).toBe('stale');
    expect(h.reason).toContain('取得自体は成功');
  });

  it('59日ならまだ ok', () => {
    expect(classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(59) }, NOW).level).toBe('ok');
  });

  it('取得の失敗は更新の停止より優先する', () => {
    // 読めていないなら、新着が無いのは当たり前なので理由として出さない。
    const h = classifyFeed({ errorCount: 5, lastArticleAt: daysAgo(300) }, NOW);
    expect(h.level).toBe('failing');
  });

  it('登録直後で記事が無くても騒がない', () => {
    const h = classifyFeed({ errorCount: 0, lastArticleAt: null, createdAt: daysAgo(2) }, NOW);
    expect(h.level).toBe('ok');
  });

  it('登録から2週間たって記事が1件も無ければ stale', () => {
    const h = classifyFeed({ errorCount: 0, lastArticleAt: null, createdAt: daysAgo(14) }, NOW);
    expect(h.level).toBe('stale');
    expect(h.reason).toContain('1件も');
  });

  it('日付が壊れていても落ちない', () => {
    expect(classifyFeed({ errorCount: 0, lastArticleAt: 'なんだこれ' }, NOW).level).toBe('ok');
  });

  it('本文がほとんど取れないフィードを知らせる', () => {
    // 東洋経済の実データ（427件中347件＝81%）。取得は正常で新着も毎日ある。
    const health = classifyFeed(
      { errorCount: 0, lastArticleAt: daysAgo(1), extracted: 427, unreadable: 347 },
      NOW,
    );
    expect(health.level).toBe('unreadable');
    expect(health.reason).toContain('81%');
  });

  it('たまに失敗するだけのフィードは正常のまま', () => {
    // Hacker News の実データ（1166件中185件＝16%）。読める記事のほうが多い。
    expect(
      classifyFeed(
        { errorCount: 0, lastArticleAt: daysAgo(1), extracted: 1166, unreadable: 185 },
        NOW,
      ).level,
    ).toBe('ok');
  });

  it('件数が少ないうちは割合を見ない', () => {
    // 購読したてで3件中2件が失敗、を「67%が読めません」と言わない。
    expect(
      classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(1), extracted: 3, unreadable: 2 }, NOW)
        .level,
    ).toBe('ok');
  });

  it('取得できていないほうを優先する', () => {
    // 読めるかどうか以前に、フィードが取れていない。
    expect(
      classifyFeed(
        { errorCount: 12, lastArticleAt: daysAgo(1), extracted: 100, unreadable: 100 },
        NOW,
      ).level,
    ).toBe('dead');
  });

  it('件数が無ければ従来どおり', () => {
    expect(classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(1) }, NOW).level).toBe('ok');
  });
});

describe('needsAttention', () => {
  it('手当てが要るものだけを重い順に返す', () => {
    const feeds = [
      { id: 'ok', errorCount: 0, lastArticleAt: daysAgo(1) },
      { id: 'stale', errorCount: 0, lastArticleAt: daysAgo(90) },
      { id: 'dead', errorCount: 12, lastArticleAt: daysAgo(1) },
      { id: 'failing', errorCount: 4, lastArticleAt: daysAgo(1) },
      { id: 'unreadable', errorCount: 0, lastArticleAt: daysAgo(1), extracted: 100, unreadable: 90 },
    ];
    expect(needsAttention(feeds, NOW).map((r) => r.feed.id)).toEqual([
      'dead',
      'failing',
      'unreadable',
      'stale',
    ]);
  });

  it('全部正常なら空', () => {
    expect(needsAttention([{ errorCount: 0, lastArticleAt: daysAgo(1) }], NOW)).toEqual([]);
  });
});

describe('日付が入らないフィード', () => {
  it('ほぼ全部に日付が無ければ知らせる', () => {
    // 千葉県の実データ（100件中100件）。取得も本文も要約も正常なので、
    // これが出ないと「新着が来ていない」としか見えない。
    const health = classifyFeed(
      { errorCount: 0, lastArticleAt: daysAgo(1), ingested: 100, undated: 100 },
      NOW,
    );
    expect(health.level).toBe('undated');
    expect(health.reason).toContain('100件');
  });

  it('一部に無いだけなら騒がない', () => {
    // 日付を打たない項目が混ざるフィードは普通にある（鎌ケ谷市など）。
    expect(
      classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(1), ingested: 100, undated: 20 }, NOW)
        .level,
    ).toBe('ok');
  });

  it('件数が少ないうちは割合を見ない', () => {
    expect(
      classifyFeed({ errorCount: 0, lastArticleAt: daysAgo(1), ingested: 3, undated: 3 }, NOW).level,
    ).toBe('ok');
  });

  it('本文が取れないほうを先に出す', () => {
    // どちらも当てはまるときは、要約が薄くなるほうが重い。
    expect(
      classifyFeed(
        {
          errorCount: 0,
          lastArticleAt: daysAgo(1),
          extracted: 100,
          unreadable: 90,
          ingested: 100,
          undated: 100,
        },
        NOW,
      ).level,
    ).toBe('unreadable');
  });
});
