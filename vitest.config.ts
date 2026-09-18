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
    /**
     * The service layer reads DATABASE_URL. Without pinning it here, a test that
     * exercises a service silently queried the DEVELOPMENT database while its
     * own fixtures lived in the test one — so it saw no data and "passed" by
     * finding nothing. Point both at the test database.
     */
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted_test",
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted_test",
      SESSION_SECRET: "test-only-secret",
    },
    globalSetup: ["./test/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@letsorted/rules": r("./packages/rules/src/index.ts"),
      "@": r("./apps/web/src"),
    },
  },
});
