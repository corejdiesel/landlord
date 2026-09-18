import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["packages/rules/src/**"],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
    testTimeout: 30000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@letsorted/rules": r("./packages/rules/src/index.ts"),
      "@": r("./apps/web/src"),
    },
  },
});
