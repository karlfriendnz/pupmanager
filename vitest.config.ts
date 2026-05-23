import { defineConfig } from 'vitest/config'

// Vitest runs the fast unit tests only. Playwright specs (tests/smoke,
// tests/e2e — `*.spec.ts`) are run by Playwright, not Vitest; without this
// scoping Vitest's default glob picks them up and errors on `test.describe`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', '.next', '.next-e2e', 'tests/smoke', 'tests/e2e'],
  },
})
