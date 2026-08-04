/**
 * READ-ONLY. Is every cron route in this repo actually SCHEDULED in production?
 *
 *   npx dotenv -e .env.local -o -- npx tsx scripts/audit/cron-schedule-check.ts
 *
 * Why this exists (audit T-16). `billing-reconcile` was written after a customer
 * held two live Stripe subscriptions for ten days and paid both, with nothing in
 * the app noticing. Its own header says:
 *
 *   "adding it to scripts/setup-supabase-crons.ts is not the same as scheduling
 *    it — that script has to be RUN."
 *
 * It wasn't. The job existed, passed review, and had never run once. A safety
 * net nobody hung up.
 *
 * This cannot be a vitest check: the schedule lives in Supabase's `cron.job`
 * table, not in the repo. So it is a script to run before a release, and after
 * any cron work — including a CRON_SECRET rotation, which has to rewrite every
 * job and silently 401s the ones it misses.
 *
 * Exits 1 when a cron that touches money is unscheduled, so CI or a release
 * script can gate on it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scriptPrisma } from '../../src/lib/prisma-script'

const CRON_DIR = join(process.cwd(), 'src/app/api/cron')

/** Jobs that legitimately have no schedule, and why. */
const UNSCHEDULED_ON_PURPOSE: Record<string, string> = {
  'keep-warm':
    'Only useful if something calls it; there is nothing to miss if nobody does.',
  'google-calendar-backfill':
    'A one-shot repair, run by hand when a trainer reconnects a calendar. Not a recurring job.',
}

/** Does this job move, chase or reconcile money? */
function touchesMoney(src: string): boolean {
  return /invoice|Invoice|stripe|Stripe|subscription|charge|receivable/.test(src)
}

async function main() {
  const prisma = scriptPrisma()
  const host = (process.env.DATABASE_URL || process.env.DIRECT_URL || '').split('@')[1]?.split('/')[0]
  console.log(`\nReading (and only reading) ${host}\n`)

  const inCode = readdirSync(CRON_DIR).filter(d => statSync(join(CRON_DIR, d)).isDirectory())

  let scheduled: string[] = []
  try {
    const rows = (await prisma.$queryRawUnsafe(
      'select jobname from cron.job where active',
    )) as { jobname: string }[]
    // Jobs are named pm-<route> or pupmanager-<route> depending on when they
    // were added; the route directory is the identity.
    scheduled = rows.map(r => String(r.jobname).replace(/^(pm-|pupmanager-)/, ''))
  } catch (e) {
    console.error('Could not read cron.job — is this pointed at Supabase?', (e as Error).message)
    process.exit(2)
  }

  const missing = inCode.filter(c => !scheduled.includes(c) && !(c in UNSCHEDULED_ON_PURPOSE))
  const orphans = scheduled.filter(s => !inCode.includes(s))

  console.log(`cron routes in code: ${inCode.length}   ·   active schedules: ${scheduled.length}\n`)

  let moneyMissing = 0
  if (missing.length === 0) {
    console.log('Every cron route has a schedule.')
  } else {
    console.log('IN CODE BUT NOT SCHEDULED — these have never run:')
    for (const m of missing) {
      const money = touchesMoney(readFileSync(join(CRON_DIR, m, 'route.ts'), 'utf8'))
      if (money) moneyMissing++
      console.log(`  ${money ? 'MONEY ' : '      '}${m}`)
    }
  }

  if (orphans.length) {
    console.log('\nSCHEDULED BUT NO LONGER IN CODE — these 404 on every run:')
    for (const o of orphans) console.log(`   ${o}`)
  }

  console.log('\nNothing was written.\n')
  await prisma.$disconnect()

  // A missing money job is the failure this script exists for.
  if (moneyMissing > 0) process.exit(1)
}

main().catch(e => {
  console.error('FAILED', e)
  process.exit(2)
})
