// Boots a throwaway embedded Postgres, syncs the current Prisma schema onto it
// with `db push` (the migration history doesn't replay cleanly from zero — a
// known pre-existing drift — and tests don't need history), then seeds one
// owner trainer + a little data. The PG instance is stashed on globalThis so
// global-teardown can stop it.
import EmbeddedPostgres from 'embedded-postgres'
import { execSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import { TEST_DB, TEST_DATABASE_URL, SEED } from './test-db'

export default async function globalSetup() {
  // The seeding PrismaClient (below) reads DATABASE_URL at construction.
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DIRECT_URL = TEST_DATABASE_URL

  const pg = new EmbeddedPostgres({
    databaseDir: TEST_DB.dataDir,
    user: TEST_DB.user,
    password: TEST_DB.password,
    port: TEST_DB.port,
    persistent: false, // wipe the data dir on stop
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase(TEST_DB.database)
  ;(globalThis as unknown as { __E2E_PG__?: EmbeddedPostgres }).__E2E_PG__ = pg

  console.log('[e2e] embedded postgres up — pushing schema…')
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
  })

  // Seed an owner trainer (verified, with a credentials password) + an OWNER
  // membership + a sample client and package so specs have data to assign.
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  const prisma = new PrismaClient()
  try {
    const hash = await bcrypt.hash(SEED.owner.password, 12)
    const user = await prisma.user.create({
      data: {
        email: SEED.owner.email,
        name: SEED.owner.name,
        role: 'TRAINER',
        emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
      },
    })
    const profile = await prisma.trainerProfile.create({
      data: {
        userId: user.id,
        businessName: SEED.owner.businessName,
        subscriptionStatus: 'ACTIVE',
        seatCount: 10, // room to invite the 5 trainers
      },
    })
    await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
    })

    // A sample client + dog + a package, so assigned-trainer flows have targets.
    const clientUser = await prisma.user.create({
      data: { email: 'client@e2e.test', name: 'Sarah Client', role: 'CLIENT', emailVerified: new Date() },
    })
    const dog = await prisma.dog.create({ data: { name: 'Bailey' } })
    await prisma.clientProfile.create({
      data: { userId: clientUser.id, trainerId: profile.id, dogId: dog.id, status: 'ACTIVE' },
    })
    await prisma.package.create({
      data: { trainerId: profile.id, name: 'Puppy Foundations', sessionCount: 4, weeksBetween: 1 },
    })
    console.log('[e2e] seed complete')
  } finally {
    await prisma.$disconnect()
  }
}
