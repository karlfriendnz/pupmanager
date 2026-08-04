import { defineConfig, devices } from '@playwright/test'
// Ad-hoc audit runner against the ALREADY-RUNNING local dev server (port 7777).
// Not part of CI. Findings get promoted to tests/e2e/audit-settings.spec.ts.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  use: { baseURL: 'http://localhost:7777', trace: 'off', screenshot: 'off', storageState: 'tests/audit/.state.json' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
