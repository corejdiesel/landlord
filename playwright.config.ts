import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * The web server runs a production build with every adapter mocked and the date
 * pinned, so the journey test exercises the same code path a demo does, and the
 * deadline arithmetic is deterministic.
 */
const DEMO_DATE = "2027-01-20";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          /**
           * This environment ships a Chromium build that does not match the
           * revision our @playwright/test version expects, and browser
           * downloads are disabled. Point at the one that is actually here.
           */
          ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: {
    // `pnpm --filter ... -- -p` mangles the port argument, and `next` is only
    // installed in the web workspace, so run it from there.
    command: "pnpm exec next start -p 3100",
    cwd: "./apps/web",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL
        ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted_e2e",
      FORCE_MOCKS: "1",
      ALLOW_TIME_TRAVEL: "1",
      TIME_TRAVEL_DATE: DEMO_DATE,
      SESSION_SECRET: "e2e-only-secret",
      APP_URL: "http://127.0.0.1:3100",
      NODE_ENV: "production",
    },
  },
});
