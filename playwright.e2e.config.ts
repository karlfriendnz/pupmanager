import { defineConfig, devices } from '@playwright/test'
import { TEST_DATABASE_URL } from './tests/e2e/test-db'

// Full-flow E2E config — distinct from the DB-free smoke tests (playwright.config.ts).
// These run `next dev` against an isolated embedded Postgres (see tests/e2e/global-setup.ts)
// so authenticated, data-creating flows never touch production. RESEND is pointed at a
// fake key so invites create memberships without sending real email.
const PORT = Number(process.env.E2E_PORT ?? 3017)
const BASE_URL = `http://localhost:${PORT}`
const E2E_DIST_DIR = '.next-e2e'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shared seeded DB — keep specs serial
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Production build + start (not `next dev`): Next 16 forbids a second dev
    // server, and `next start` is closer to prod anyway. The build doesn't hit
    // the DB (pages are dynamic), so it's fine before the test PG is seeded.
    command: `npx next build && npx next start --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Point the app at the throwaway test DB and stub email so no real
      // invites are sent. Everything else (AUTH_SECRET, APNS, …) comes from
      // .env.local, which next still loads. E2E_DIST_DIR isolates this build
      // from any running `next dev` (.next).
      E2E_DIST_DIR,
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      RESEND_API_KEY: 're_e2e_fake_key',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      AUTH_URL: BASE_URL,
      // The suite logs in many times from a single loopback IP; lift the
      // brute-force login cap (prod default 30/15min) so it doesn't trip.
      LOGIN_RATE_LIMIT_MAX: '100000',
    },
  },
})
