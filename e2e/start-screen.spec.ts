import { expect, test } from '@playwright/test';

/**
 * 起動の1枚目（`public/start.html`）。manifest の `start_url` がここを指す。
 *
 * 見たいのは3つ:
 *   1. **描いてから移ること**——1フレームも描かずに `/` へ行くと、挟んだ意味が
 *      丸ごと消えて真っ暗のままになる（docs/traps/perf.md）
 *   2. 自分で出ていき、**履歴に残らない**こと（戻るでここへ戻らない）
 *   3. **サービスワーカーのキャッシュから返っている**こと（＝サーバーを待たない）
 *
 * 1 を「移る前に画面を覗いて」確かめようとすると、覗く前に移ってしまって測れない。
 * なので**あちらに記録させたもの**（localStorage の `rsstube-launch-v1`）を、
 * 移ったあとに読む。本番で実機の数字を持ち帰るのと同じ経路。
 */
test('起動画面は描かれてから / へ移る', async ({ page }) => {
  await page.goto('/start.html');

  // 未ログインなので `/` から `/login` へ送られる。どこへ行くにせよ、ここからは出る。
  await page.waitForURL((url) => !url.pathname.includes('start.html'), { timeout: 20_000 });

  const launch = await page.evaluate(() => {
    const raw = localStorage.getItem('rsstube-launch-v1');
    return raw ? (JSON.parse(raw) as { origin: number; paintAt: number; fcp: number | null }) : null;
  });

  expect(launch).not.toBeNull();
  // **描かれた合図が残っていること。** ここが null なら、移る前に描けていない疑い。
  expect(launch!.fcp).not.toBeNull();
  expect(launch!.fcp! - launch!.origin).toBeGreaterThan(0);
  // 1枚目に何秒もかけていないこと（キャッシュから返る静的な1枚なので一瞬）。
  expect(launch!.paintAt - launch!.origin).toBeLessThan(3000);

  // replace で移っているので、戻ってもここへは戻らない。
  await page.goBack().catch(() => {});
  expect(page.url()).not.toContain('start.html');
});

/**
 * **圏外でも起動画面は出る。** ＝ サーバーではなくキャッシュから返っている証拠。
 *
 * キャッシュに入っていなければ、ここは `goto` の時点で通信できずに落ちる。
 * そのあと本体へ移れないので、行き先は offline.html になる（それでよい）。
 */
test('圏外でも起動画面はキャッシュから出る', async ({ page, context }) => {
  // まず1枚開いて、サービスワーカーを登録・有効化させる。
  await page.goto('/login');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
    timeout: 20_000,
  });

  await context.setOffline(true);
  try {
    // ここが通ること自体が証拠——通信できないので、キャッシュから返る以外に道が無い。
    const res = await page.goto('/start.html');
    expect(res?.status() ?? 599).toBeLessThan(400);

    // 1枚目は自分で本体へ移る。圏外なので行き先は offline.html になる。
    await page.waitForURL((url) => !url.pathname.includes('start.html'), { timeout: 20_000 });
    await expect(page).toHaveTitle(/圏外/);
  } finally {
    await context.setOffline(false);
  }
});
