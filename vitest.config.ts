import { defineConfig } from 'vitest/config'
import path from 'path'

// Vitest runs the fast unit tests only. Playwright specs (tests/smoke,
// tests/e2e — `*.spec.ts`) are run by Playwright, not Vitest; without this
// scoping Vitest's default glob picks them up and errors on `test.describe`.
export default defineConfig({
  // Mirror the app's "@/..." → "src/..." path alias so unit tests can import
  // (and mock) modules that reference it internally (e.g. route handlers).
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', '.next', '.next-e2e', 'tests/smoke', 'tests/e2e'],
  },
})
