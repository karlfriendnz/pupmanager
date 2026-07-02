import 'dotenv/config'
import path from 'node:path'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 moved connection URLs out of schema.prisma into this file.
//
// - Runtime queries connect through the pg driver adapter in src/lib/prisma.ts
//   using DATABASE_URL (the pooled, per-environment URL).
// - Migrations / introspection (prisma migrate, db push, studio) use the
//   `datasource.url` below — the DIRECT (non-pooled) URL.
//
// Env resolution: the db:*:dev npm scripts run `dotenv -e .env.development.local`
// first, so process.env already holds the dev-DB URLs before this file loads;
// dotenv's default (no-override) behaviour means the `import 'dotenv/config'`
// above only fills in anything not already set (from .env / prod on Vercel).
// Net effect matches the pre-7 setup: dev scripts hit pupmanager_dev, and a
// bare `prisma migrate`/build hits DIRECT_URL (prod) exactly as before.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
})
