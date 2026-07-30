/**
 * Keep the layout a trainer chose, now that "Day" means something else.
 *
 * WHY: the schedule's one-day LIST was called "Day". It's now called "Agenda", and
 * "Day" is a real hour-by-hour grid for a single day (Karl, 2026-07-30). The stored
 * preference is the string 'day' — so without this, a trainer who deliberately
 * chose the list would open their schedule and find a grid instead. Same value,
 * different meaning, which is the kind of change that looks like a bug.
 *
 * Only touches rows whose stored value is exactly 'day'. Re-running is a no-op:
 * there is nothing left matching once it has run.
 *
 *   DRY RUN:  npx dotenv -e .env.development.local -- npx tsx scripts/backfill-schedule-agenda-view.ts
 *   APPLY:    npx dotenv -e .env.development.local -- npx tsx scripts/backfill-schedule-agenda-view.ts --apply
 *   PROD:     npx dotenv -e .env.local -- npx tsx scripts/backfill-schedule-agenda-view.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

async function main() {
  // Both are stored separately: a trainer can want a list on their phone and a
  // week on the desktop.
  const [desktop, mobile] = await Promise.all([
    prisma.trainerProfile.count({ where: { scheduleView: 'day' } }),
    prisma.trainerProfile.count({ where: { scheduleMobileView: 'day' } }),
  ])

  console.log(`${desktop} desktop and ${mobile} mobile preference(s) say 'day'${apply ? '' : ' (dry run)'}.`)
  if (desktop + mobile === 0) {
    console.log('Nothing to move — no trainer had chosen the list.')
    return
  }

  if (apply) {
    const [d, m] = await Promise.all([
      prisma.trainerProfile.updateMany({ where: { scheduleView: 'day' }, data: { scheduleView: 'agenda' } }),
      prisma.trainerProfile.updateMany({ where: { scheduleMobileView: 'day' }, data: { scheduleMobileView: 'agenda' } }),
    ])
    console.log(`Moved ${d.count} desktop and ${m.count} mobile preference(s) to 'agenda'.`)
  } else {
    console.log("Re-run with --apply to move them to 'agenda'.")
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
