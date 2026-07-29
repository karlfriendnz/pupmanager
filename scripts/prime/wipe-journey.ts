/**
 * Wipe EVERYTHING belonging to the Journey Dog Training trainer on LOCAL DEV,
 * then recreate the empty trainer shell so an import can be tested from clean.
 *
 * Deleting the TrainerProfile cascades its owned rows (clients, dogs, classes,
 * packages, custom fields, …). The client *User* rows are NOT cascaded — a User
 * owns its ClientProfile, not the other way round — so their ids are collected
 * BEFORE the cascade and deleted afterwards, and only when the user has no
 * remaining ClientProfile under some other trainer.
 *
 * Run against LOCAL DEV — the -o is load-bearing, see ensure-fields.ts:
 *   dotenv -e .env.development.local -o -- tsx scripts/prime/wipe-journey.ts
 *
 * Destructive. Refuses to run against anything but local pupmanager_dev.
 */
import { scriptPrisma } from '../../src/lib/prisma-script'

const prisma = scriptPrisma()

const TRAINER_EMAIL = 'journey@pupmanager.dev'

function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? ''
  if (!(/localhost|127\.0\.0\.1/.test(url) && /pupmanager_dev/.test(url))) {
    console.error('\n✋ Refusing to run: DATABASE_URL is not local pupmanager_dev.')
    console.error('   Run with: dotenv -e .env.development.local -o -- tsx scripts/prime/wipe-journey.ts\n')
    process.exit(1)
  }
}

async function main() {
  assertLocalDb()

  const user = await prisma.user.findUnique({
    where: { email: TRAINER_EMAIL },
    select: { id: true, trainerProfile: { select: { id: true } } },
  })
  const trainerId = user?.trainerProfile?.id
  if (!trainerId) {
    console.log(`\nNothing to wipe — no trainer profile for ${TRAINER_EMAIL}.\n`)
    return
  }

  const before = {
    clients: await prisma.clientProfile.count({ where: { trainerId } }),
    customFields: await prisma.customField.count({ where: { trainerId } }),
    packages: await prisma.package.count({ where: { trainerId } }),
  }
  console.log(`\nTrainer ${trainerId} (${TRAINER_EMAIL})`)
  console.log(`  before: ${before.clients} clients · ${before.packages} packages · ${before.customFields} custom fields`)

  // Almost every trainerId relation is onDelete: Cascade, but TWO are not and
  // will block the trainer delete: ClientProfile.trainer and ClientShare
  // (sharedBy/sharedWith). Dog.owner has no onDelete either, so dogs OUTLIVE
  // their owner — they have to be collected first and deleted by id.
  const profiles = await prisma.clientProfile.findMany({
    where: { trainerId },
    select: { userId: true, dogId: true, dogs: { select: { id: true } } },
  })
  const clientUserIds = profiles.map((c) => c.userId)
  const dogIds = [
    ...new Set(
      profiles.flatMap((c) => [c.dogId, ...c.dogs.map((d) => d.id)]).filter((id): id is string => !!id)
    ),
  ]

  const shares = await prisma.clientShare.deleteMany({
    where: { OR: [{ sharedById: trainerId }, { sharedWithId: trainerId }] },
  })
  console.log(`  deleted ${shares.count} client shares`)

  const removedProfiles = await prisma.clientProfile.deleteMany({ where: { trainerId } })
  console.log(`  deleted ${removedProfiles.count} client profiles (cascade)`)

  const removedDogs = await prisma.dog.deleteMany({ where: { id: { in: dogIds } } })
  console.log(`  deleted ${removedDogs.count} dogs (of ${dogIds.length} referenced)`)

  await prisma.trainerProfile.delete({ where: { id: trainerId } })
  console.log(`  deleted trainer profile (cascade)`)

  // Only remove client Users left with no ClientProfile anywhere — a person can
  // be a client of more than one trainer.
  let removedUsers = 0
  for (const id of clientUserIds) {
    const stillUsed = await prisma.clientProfile.count({ where: { userId: id } })
    if (stillUsed === 0) {
      await prisma.user.delete({ where: { id } }).then(() => { removedUsers++ }).catch(() => {})
    }
  }
  console.log(`  deleted ${removedUsers} orphaned client users (of ${clientUserIds.length})`)

  // Finally the trainer's own login, so create-trainer.ts rebuilds it fresh.
  await prisma.user.delete({ where: { id: user!.id } }).catch(() => {})
  console.log(`  deleted trainer user`)

  console.log('\n✅ Journey wiped. Now run:')
  console.log('   dotenv -e .env.development.local -o -- tsx scripts/prime/create-trainer.ts')
  console.log('   dotenv -e .env.development.local -o -- tsx scripts/prime/ensure-fields.ts\n')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
