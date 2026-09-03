import { test, expect } from '@playwright/test';

test.describe('Authentication and Login UI', () => {
  test('redirects unauthenticated user to /login and renders login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('RSSTube');
  });

  test('login page contains required form fields and actions', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name=email]')).toBeVisible();
    await expect(page.locator('input[name=password]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'パスキーでログイン' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'パスワードを設定・再設定する' })).toBeVisible();
  });
});
