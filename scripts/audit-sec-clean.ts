/**
 * Removes every `secaudit-` fixture created by audit-sec-seed.ts. LOCAL DEV ONLY.
 * Run: dotenv -e .env.development.local -o -- npx tsx scripts/audit-sec-clean.ts
 */
import { scriptPrisma } from '../src/lib/prisma-script'

const prisma = scriptPrisma()
const MARK = 'secaudit'

async function main() {
  if (!process.env.DATABASE_URL?.includes('localhost')) {
    throw new Error('Refusing to run: DATABASE_URL is not localhost')
  }
  const users = await prisma.user.findMany({
    where: { email: { startsWith: MARK } },
    select: { id: true, trainerProfile: { select: { id: true } }, clientProfiles: { select: { id: true } } },
  })
  const companyIds = users.map(u => u.trainerProfile?.id).filter(Boolean) as string[]
  const clientIds = users.flatMap(u => u.clientProfiles.map(c => c.id))
  const userIds = users.map(u => u.id)

  // Children first where cascade may not cover it.
  await prisma.invoice.deleteMany({ where: { trainerId: { in: companyIds } } })
  await prisma.trainingSession.deleteMany({ where: { trainerId: { in: companyIds } } })
  await prisma.dog.deleteMany({ where: { clientProfileId: { in: clientIds } } })
  await prisma.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await prisma.trainerMembership.deleteMany({ where: { companyId: { in: companyIds } } })
  await prisma.trainerProfile.deleteMany({ where: { id: { in: companyIds } } })
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  // Orphan dogs created by a half-failed seed.
  await prisma.dog.deleteMany({ where: { name: { startsWith: 'Dog-' }, clientProfileId: null, sessions: { none: {} } } })
  console.log(`removed ${userIds.length} audit users / ${companyIds.length} businesses`)
}

main().finally(() => prisma.$disconnect())
