import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * テスト対象は外部依存のない純関数だけ（URL正規化・OPML・Markdown生成）。
 * DBやGeminiに触る層はここでは扱わないので environment は node のままでよい。
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
