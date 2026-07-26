import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

// Standalone PrismaClient for tsx-run scripts + seeds (NOT the app runtime — use
// src/lib/prisma.ts for that). Prisma 7 requires a JS driver adapter and no
// longer auto-loads .env at runtime, so this factory does both: builds the pg
// adapter and loads .env.
//
// `import 'dotenv/config'` above fills process.env from .env WITHOUT overriding
// anything already set — so the db:*:dev npm scripts (which run
// `dotenv -e .env.development.local` first) still target pupmanager_dev, while a
// bare `tsx scripts/foo.ts` connects to whatever .env holds, exactly as before 7.
export function scriptPrisma(
  // Falls back to DIRECT_URL: .env carries the pooled prod connection there and
  // leaves DATABASE_URL blank, so a bare `tsx scripts/foo.ts` was handing the
  // adapter an empty string and connecting to a local database named after the
  // shell user ("database `karl` does not exist"). The db:*:dev scripts set
  // DATABASE_URL explicitly, so they still win and still target dev.
  connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL,
) {
  if (!connectionString) {
    throw new Error('No DATABASE_URL or DIRECT_URL — load the right .env before running this script.')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
