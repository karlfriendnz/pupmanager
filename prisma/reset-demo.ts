// Reset the demo trainer's data — wipe client-facing records without
// touching the trainer's own login. Sister script to seed-demo.ts;
// shares the same lib so admin panel and CLI behave identically.
//
// Run with: `npm run db:reset-demo`

import { PrismaClient } from '../src/generated/prisma'
import {
  DEMO_EMAIL,
  ensureDemoTrainer,
  resetDemoData,
} from '../src/lib/demo-seed'

const prisma = new PrismaClient()

async function main() {
  console.log(`Resetting demo trainer: ${DEMO_EMAIL}`)
  const trainerId = await ensureDemoTrainer(prisma)
  const result = await resetDemoData(prisma, trainerId)

  console.log(`✓ Demo trainer reset`)
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k.padEnd(18)} ${v}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
