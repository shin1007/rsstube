import { test, expect } from '@playwright/test';

test.describe('Article Mobile View & Bottom Navigation Layout', () => {
  test('verifies mobile menu button and bottom nav position on mobile viewport', async ({ page, isMobile }) => {
    // 画面サイズ設定（Mobile Chrome の場合 393 x 851）
    await page.goto('/api/debug/article');

    // 1. 本文が正常に描画されているか
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // 2. 「前の記事」「次の記事」ナビゲーションバーの取得
    const nav = page.locator('nav').filter({ hasText: '前の記事' });
    await expect(nav).toBeVisible();

    // 3. ナビゲーションバーがビューポート下端（画面内）に配置されているか厳密に計算
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const viewportHeight = viewport!.height;

    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();

    // ナビゲーションの下端 (y + height) がビューポートの高さと一致（または画面最下部内にピッタリ収まる）
    const navBottom = navBox!.y + navBox!.height;
    expect(navBottom).toBeLessThanOrEqual(viewportHeight + 1);
    expect(navBottom).toBeGreaterThanOrEqual(viewportHeight - 10);

    // 4. スマホ用フローティングメニューボタン (ArticleMobileMenu) の検証
    if (isMobile) {
      const fabButton = page.getByRole('button', { name: '記事のメニューを開く' });
      await expect(fabButton).toBeVisible();

      // フローティングボタンが画面下部（navの上）に浮いていること
      const fabBox = await fabButton.boundingBox();
      expect(fabBox).not.toBeNull();
      expect(fabBox!.y + fabBox!.height).toBeLessThan(viewportHeight);

      // タップしてメニューが開くこと
      await fabButton.click();
      await expect(page.getByRole('button', { name: 'メニューを閉じる' })).toBeVisible();
      await expect(page.getByRole('button', { name: /スター/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /あとで/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /NotebookLM/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /音声/ })).toBeVisible();

      // もう一度タップして閉じること
      await page.getByRole('button', { name: 'メニューを閉じる' }).click();
      await expect(page.getByRole('button', { name: '記事のメニューを開く' })).toBeVisible();
    }
  });
});
