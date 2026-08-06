import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

// Prisma 7: the runtime client connects through a JS driver adapter (pg) using
// DATABASE_URL — the pooled, per-environment URL that Next loads from the right
// .env file (dev → pupmanager_dev, prod → prod). Migration URLs live in
// prisma.config.ts, not here.
//
// Cache key is versioned (`v4` was the adapter switch, `v6` the
// MessageAttachment model) so HMR forces a fresh instance whenever the generated
// client changes — otherwise dev keeps the old client cached on globalThis
// across module reloads, and any schema change shows up as a validation error
// until the process restarts. The exported `prisma` symbol stays unchanged, so
// callers don't care about the key name.
//
// BUMP THIS whenever you add a model or a field. It costs nothing in production
// (one global key name) and it is the difference between a running dev server
// picking up your schema and it 500ing on an "unknown field" until somebody
// works out the client is stale.
const globalForPrisma = globalThis as unknown as {
  prismaV6: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prismaV6 ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

globalForPrisma.prismaV6 = prisma
