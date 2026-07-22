/**
 * Create (idempotent) the "Journey Dog Training" trainer — the target account
 * for the PRIME PUPS / Journey Dog Training data import. A loginable sandbox
 * trainer: User (TRAINER, verified) + credentials password + TrainerProfile +
 * OWNER membership. Configured as a puppy school (classes-enabled).
 *
 * Run against LOCAL DEV:
 *   dotenv -e .env.development.local -- tsx scripts/prime/create-trainer.ts
 *
 * Re-runnable: upserts by email, refreshes the password, never duplicates.
 * Prints the trainer id + login on success.
 */
import { scriptPrisma } from '../../src/lib/prisma-script'
import bcrypt from 'bcryptjs'

const prisma = scriptPrisma()

const EMAIL = 'journey@pupmanager.dev'
const PASSWORD = 'JourneyDog2026!'
const NAME = 'Journey Dog Training'
const BUSINESS = 'Journey Dog Training'
const PHONE = '021 000 0000'
const TIMEZONE = 'Pacific/Auckland'

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12)

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { name: NAME, email: EMAIL, role: 'TRAINER', emailVerified: new Date(), timezone: TIMEZONE },
    update: { role: 'TRAINER', emailVerified: new Date(), timezone: TIMEZONE },
  })

  // Credentials password (the hash lives in providerAccountId, per lib/auth.ts).
  const cred = await prisma.account.findFirst({ where: { userId: user.id, provider: 'credentials' } })
  if (cred) {
    await prisma.account.update({ where: { id: cred.id }, data: { providerAccountId: hash } })
  } else {
    await prisma.account.create({
      data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
    })
  }

  const profile = await prisma.trainerProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      businessName: BUSINESS,
      phone: PHONE,
      showPhoneToClients: false,
      // Long trial so the sandbox account is never gated behind billing.
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      payoutCurrency: 'nzd',
      // Puppy school → group classes enabled + a sensible schedule/offering set.
      businessRoles: ['puppyschool'],
    },
    update: { businessName: BUSINESS, phone: PHONE, businessRoles: ['puppyschool'] },
  })

  // Founding OWNER membership of its own company.
  const owner = await prisma.trainerMembership.findFirst({
    where: { companyId: profile.id, userId: user.id },
  })
  if (!owner) {
    await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
    })
  }

  console.log('\n✅ Journey Dog Training trainer ready')
  console.log('   trainerId (companyId):', profile.id)
  console.log('   userId:                ', user.id)
  console.log('   login email:           ', EMAIL)
  console.log('   login password:        ', PASSWORD)
  console.log('   businessRoles:          [puppyschool]')
  console.log('\n   → use this trainerId as the import target.\n')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
