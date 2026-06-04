import { PrismaClient } from '@/generated/prisma'

// Cache key is intentionally versioned (`v3`) so HMR forces a fresh
// instance whenever the generated client changes — otherwise dev keeps
// the old client cached on globalThis across module reloads, and any
// schema change shows up as a PrismaClientValidationError until the
// process restarts. The exported `prisma` symbol stays unchanged, so
// callers don't care about the key name.
const globalForPrisma = globalThis as unknown as {
  prismaV3: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prismaV3 ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

globalForPrisma.prismaV3 = prisma
