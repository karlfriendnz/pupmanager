/**
 * A two-rung ladder in the local database, to exercise eligibility + upgrades.
 *
 *   Juniors  $100/mo  public          (already seeded)
 *   Seniors  $150/mo  gated on "Bronze Recall"
 *
 * Local sandbox only.
 *
 *   ./node_modules/.bin/dotenv -e .env.local -e .env.development.local -o -- \
 *     npx tsx scripts/tmp-ladder-setup.ts [award|revoke]
 *
 * Temporary — delete once the ladder ships.
 */
import { scriptPrisma } from '../src/lib/prisma-script'

const TRAINER_EMAIL = 'demo@pupmanager.com'
const CLIENT_EMAIL = 'recurring-test@example.com'
const ACHIEVEMENT = 'Bronze Recall'
const SENIORS = 'Seniors'

const db = scriptPrisma()

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url) || !/pupmanager_dev/.test(url)) {
    console.error('\n✋ Local sandbox only.\n')
    process.exit(1)
  }

  const trainer = await db.trainerProfile.findFirst({
    where: { user: { email: TRAINER_EMAIL } },
    select: { id: true, businessName: true },
  })
  if (!trainer) throw new Error('no demo trainer')

  const client = await db.clientProfile.findFirst({
    where: { trainerId: trainer.id, user: { email: CLIENT_EMAIL } },
    select: { id: true },
  })
  if (!client) throw new Error('run tmp-recurring-testclock.ts setup first')

  let achievement = await db.achievement.findFirst({
    where: { trainerId: trainer.id, name: ACHIEVEMENT },
    select: { id: true },
  })
  achievement ??= await db.achievement.create({
    data: { trainerId: trainer.id, name: ACHIEVEMENT, description: 'Comes back every time, off lead.', published: true },
    select: { id: true },
  })

  const cmd = process.argv[2] ?? 'setup'

  if (cmd === 'award') {
    await db.clientAchievement.upsert({
      where: { clientId_achievementId: { clientId: client.id, achievementId: achievement.id } },
      create: { clientId: client.id, achievementId: achievement.id, awardedBy: trainer.id },
      update: {},
    })
    console.log(`  awarded "${ACHIEVEMENT}"`)
    await db.$disconnect()
    return
  }
  if (cmd === 'revoke') {
    await db.clientAchievement.deleteMany({ where: { clientId: client.id, achievementId: achievement.id } })
    console.log(`  revoked "${ACHIEVEMENT}"`)
    await db.$disconnect()
    return
  }

  let seniors = await db.membership.findFirst({
    where: { trainerId: trainer.id, name: SENIORS },
    select: { id: true },
  })
  seniors ??= await db.membership.create({
    data: {
      trainerId: trainer.id,
      name: SENIORS,
      description: 'The next rung up.',
      priceCents: 15000,
      cadence: 'RECURRING',
      interval: 'MONTH',
      published: true,
    },
    select: { id: true },
  })

  await db.membership.update({
    where: { id: seniors.id },
    data: { eligibility: 'ACHIEVEMENT', showWhenLocked: true },
  })

  const plans = await db.membershipPlan.findMany({
    where: { membershipId: seniors.id, archivedAt: null },
    select: { id: true },
  })
  if (plans.length === 0) {
    await db.membershipPlan.create({
      data: { membershipId: seniors.id, interval: 'MONTH', priceCents: 15000, order: 0 },
    })
  }

  await db.membershipPrerequisite.upsert({
    where: { membershipId_achievementId: { membershipId: seniors.id, achievementId: achievement.id } },
    create: { membershipId: seniors.id, achievementId: achievement.id },
    update: {},
  })

  const held = await db.clientAchievement.count({
    where: { clientId: client.id, achievementId: achievement.id },
  })

  console.log(`\n  ${trainer.businessName}`)
  console.log(`  Seniors       ${seniors.id}  $150/mo  gated on "${ACHIEVEMENT}"`)
  console.log(`  achievement   ${achievement.id}`)
  console.log(`  client holds it: ${held > 0}\n`)
  await db.$disconnect()
}

main().catch(err => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)) + '\n')
  process.exit(1)
})
