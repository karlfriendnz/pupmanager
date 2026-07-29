/**
 * Read-only: identify WHICH database a given env file points at, and whether
 * the live Journey Dog Training trainer lives there.
 *
 * Prints no credentials — only a truncated host, the database name, the trainer
 * count, and (if found) the Journey trainer's owner email + client count.
 *
 * Run once per env file, e.g.:
 *   ./node_modules/.bin/dotenv -e .env                   -o -- npx tsx scripts/prime/which-db.ts
 *   ./node_modules/.bin/dotenv -e .env.local             -o -- npx tsx scripts/prime/which-db.ts
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- npx tsx scripts/prime/which-db.ts
 *
 * The -o matters: DATABASE_URL is exported in the shell and would otherwise win.
 *
 * Uses scriptPrisma() rather than `new PrismaClient({ datasourceUrl })` — this
 * repo is on Prisma 7 with engine type "client", which requires a driver
 * adapter and rejects datasourceUrl outright.
 *
 * Performs SELECTs only — no writes of any kind.
 */
import { scriptPrisma } from '../../src/lib/prisma-script'

const url = process.env.DATABASE_URL ?? ''
const host = (url.match(/@([^/:]+)/)?.[1] ?? 'unknown').slice(0, 24)
const db = (url.split('/').pop() ?? '?').split('?')[0]

const prisma = scriptPrisma()

async function main() {
  const trainers = await prisma.trainerProfile.count()
  const journey = await prisma.trainerProfile.findFirst({
    where: { businessName: { contains: 'Journey', mode: 'insensitive' } },
    select: {
      id: true,
      businessName: true,
      user: { select: { email: true } },
      _count: { select: { clients: true } },
    },
  })

  console.log(`host=${host}…  db=${db}  trainers=${trainers}`)
  if (journey) {
    console.log('  JOURNEY FOUND')
    console.log(`    business : ${journey.businessName}`)
    console.log(`    owner    : ${journey.user?.email ?? '(none)'}`)
    console.log(`    clients  : ${journey._count.clients}`)
    console.log(`    id       : ${journey.id}`)
  } else {
    console.log('  no Journey trainer in this database')
  }
}

main()
  .catch((e) => console.log('  ERROR:', String(e?.message ?? e).split('\n')[0]))
  .finally(() => prisma.$disconnect())
