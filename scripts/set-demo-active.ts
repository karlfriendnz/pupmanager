// Flip the demo trainer (demo@pupmanager.com) onto an ACTIVE
// subscription with no trial window. Idempotent — re-runs are safe.
//
// Run with: `tsx scripts/set-demo-active.ts`

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const updated = await prisma.trainerProfile.updateMany({
    where: { user: { email: 'demo@pupmanager.com' } },
    data: { subscriptionStatus: 'ACTIVE', trialEndsAt: null },
  })
  console.log(`✓ Updated ${updated.count} demo trainer profile(s) to ACTIVE`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
