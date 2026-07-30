import { defineConfig } from 'vitest/config'
import path from 'path'

// Integration tests — the ones that talk to a REAL database.
//
// Kept out of `vitest.config.ts` (and therefore out of `npm test` and CI) on
// purpose: they need a running local Postgres with a seeded trainer, so a
// machine without one would see them as failures rather than as "not run".
// They refuse to run against anything but the local sandbox, so the worst a
// stray invocation can do is fail loudly.
//
//   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
//     npx vitest run --config vitest.integration.config.ts
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules', '.next', '.next-e2e', 'tests/smoke', 'tests/e2e'],
    // A real database is slower than a mock, and these create rows.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Shared fixtures in one database — parallel files would race.
    fileParallelism: false,
  },
})
