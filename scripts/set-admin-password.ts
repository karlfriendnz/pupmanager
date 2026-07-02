// One-shot: rotate the platform admin (admin@pupmanager.app) credential
// hash to the documented password. Idempotent — re-runs always replace
// the existing credentials row.
//
// Run with: `npm run set-admin-password`

import { scriptPrisma } from "../src/lib/prisma-script"
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@pupmanager.app'
const ADMIN_PASSWORD = 'Fr1end1y_01'

const prisma = scriptPrisma()

async function main() {
  const admin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  })
  if (!admin) {
    console.error(`No user found for ${ADMIN_EMAIL}. Run npm run db:seed first.`)
    process.exit(1)
  }

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  // Replace the credentials row outright — providerAccountId stores the
  // hash, which changes every run because bcrypt salt is random.
  await prisma.account.deleteMany({
    where: { userId: admin.id, provider: 'credentials' },
  })
  await prisma.account.create({
    data: {
      userId: admin.id,
      type: 'credentials',
      provider: 'credentials',
      providerAccountId: hash,
    },
  })

  console.log(`✓ Admin password updated`)
  console.log(`  Email:    ${ADMIN_EMAIL}`)
  console.log(`  Password: ${ADMIN_PASSWORD}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
