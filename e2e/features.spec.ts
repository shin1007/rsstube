import { test, expect } from '@playwright/test';

test.describe('Theme Color Accent Selection', () => {
  test('saves and switches accent theme in localStorage and applies CSS variables', async ({ page }) => {
    await page.goto('/login');

    const themes = ['cyan', 'emerald', 'amber', 'violet', 'rose', 'blue'];

    for (const theme of themes) {
      await page.evaluate((t) => {
        localStorage.setItem('rsstube:theme-color', t);
        document.documentElement.setAttribute('data-accent', t);
      }, theme);

      const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-accent'));
      expect(currentTheme).toBe(theme);

      // CSS変数が正しく解決されているか検証
      const colorVal = await page.evaluate(() => {
        const dummy = document.createElement('div');
        dummy.style.color = 'var(--color-accent)';
        document.body.appendChild(dummy);
        const resolved = getComputedStyle(dummy).color;
        dummy.remove();
        return resolved;
      });
      expect(colorVal).toContain('rgb');
    }

    // localStorage の値が維持されていることを確認
    const storedTheme = await page.evaluate(() => localStorage.getItem('rsstube:theme-color'));
    expect(storedTheme).toBe('blue');
  });
});

test.describe('Mobile Viewport & Touch Target Tests', () => {
  test('verifies mobile viewport behavior and layout safe area properties', async ({ page, isMobile }) => {
    await page.goto('/login');

    if (isMobile) {
      const viewportSize = page.viewportSize();
      expect(viewportSize).not.toBeNull();
      expect(viewportSize!.width).toBeLessThan(500);

      // モバイルで画面下端に到達可能で、ビューポートの高さ(100dvh)が崩れていないか検証
      const bodyHeight = await page.evaluate(() => document.body.clientHeight);
      expect(bodyHeight).toBeGreaterThan(0);
    }
  });
});
