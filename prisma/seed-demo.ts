// Demo account seeder for App Store reviewers and live demos.
//
// Run with: `npm run db:seed-demo`
//
// Idempotent: ensures the demo trainer exists, wipes their prior data,
// and rebuilds a fully-populated demo dataset (~50 clients, packages,
// sessions, library items, products, achievements, enquiries, etc.).
// All logic lives in src/lib/demo-seed.ts — this script is just the
// CLI entrypoint and shares the same code path as the admin panel
// /api/admin/demo/seed endpoint.

import { PrismaClient } from '../src/generated/prisma'
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  ensureDemoTrainer,
  seedDemoData,
} from '../src/lib/demo-seed'

const prisma = new PrismaClient()

async function main() {
  console.log(`Seeding demo trainer: ${DEMO_EMAIL}`)
  const trainerId = await ensureDemoTrainer(prisma)
  const result = await seedDemoData(prisma, trainerId)

  console.log(`✓ Demo trainer ready`)
  console.log(`  Email:    ${DEMO_EMAIL}`)
  console.log(`  Password: ${DEMO_PASSWORD}`)
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k.padEnd(18)} ${v}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
