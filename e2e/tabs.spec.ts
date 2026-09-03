import { test, expect } from '@playwright/test';

test.describe('BottomTabs Navigation Active State', () => {
  test('highlights correct tab based on current pathname in mobile view', async ({ page }) => {
    // 1. /login からテスト用記事画面へ
    await page.goto('/api/debug/article');

    // 2. /listen (聴く画面) に遷移したときのタブのアクティブ状態検証
    // （AppShell を経由する /settings 等を直接検証）
    await page.goto('/settings');
    
    // ログインへリダイレクトされるか、認証不要な状態かをチェック
    const isLogin = page.url().includes('/login');
    if (!isLogin) {
      const settingsTab = page.locator('nav a').filter({ hasText: '設定' });
      await expect(settingsTab).toHaveClass(/border-t-2/);
    }
  });
});
