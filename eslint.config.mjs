import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // サービスワーカーは window ではなく ServiceWorkerGlobalScope で動く。
    // /* eslint-env */ コメントは flat config では効かず v10 でエラーになるので、
    // グローバルはこちらで宣言する。
    files: ["public/sw.js"],
    languageOptions: {
      globals: { self: "readonly", caches: "readonly", clients: "readonly", Response: "readonly" },
    },
  },
]);

export default eslintConfig;
