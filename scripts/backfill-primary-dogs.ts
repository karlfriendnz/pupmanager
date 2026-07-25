/**
 * Give every household with dogs a PRIMARY dog.
 *
 * WHY: neither dog-create route set ClientProfile.dogId, so any dog added after
 * the client was created landed as an "additional" dog only. A household could
 * have four dogs and no primary — which is what made the clients list show
 * "No dog" next to a client who plainly had one (reported July 2026).
 *
 * Both routes now promote the first dog automatically; this fixes the ones
 * already in that state, choosing the OLDEST dog (the one they added first,
 * which is what the rule would have picked at the time).
 *
 *   DRY RUN:  npx dotenv -e .env -- npx tsx scripts/backfill-primary-dogs.ts
 *   APPLY:    npx dotenv -e .env -- npx tsx scripts/backfill-primary-dogs.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

async function main() {
  const orphans = await prisma.clientProfile.findMany({
    where: { dogId: null, dogs: { some: {} } },
    select: {
      id: true,
      user: { select: { name: true, email: true } },
      dogs: { select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  })

  console.log(`${orphans.length} client${orphans.length === 1 ? '' : 's'} with dogs but no primary\n`)

  for (const c of orphans) {
    const first = c.dogs[0]
    const others = c.dogs.length > 1 ? ` (+${c.dogs.length - 1} more)` : ''
    console.log(`${c.user?.name ?? c.user?.email ?? c.id}: primary → ${first.name}${others}`)
    if (apply) {
      await prisma.clientProfile.update({ where: { id: c.id }, data: { dogId: first.id } })
    }
  }

  console.log(apply ? '\nApplied.' : '\nDry run — pass --apply to write.')
}

main().finally(() => prisma.$disconnect())
