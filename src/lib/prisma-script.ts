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
export function scriptPrisma(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
