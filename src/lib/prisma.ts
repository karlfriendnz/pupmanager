import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

// Prisma 7: the runtime client connects through a JS driver adapter (pg) using
// DATABASE_URL — the pooled, per-environment URL that Next loads from the right
// .env file (dev → pupmanager_dev, prod → prod). Migration URLs live in
// prisma.config.ts, not here.
//
// Cache key is versioned (bumped to `v4` for the adapter switch) so HMR forces a
// fresh instance whenever the generated client changes — otherwise dev keeps the
// old client cached on globalThis across module reloads, and any schema change
// shows up as a validation error until the process restarts. The exported
// `prisma` symbol stays unchanged, so callers don't care about the key name.
const globalForPrisma = globalThis as unknown as {
  prismaV4: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prismaV4 ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

globalForPrisma.prismaV4 = prisma
