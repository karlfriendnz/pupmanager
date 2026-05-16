// Re-schedule the pm-* Supabase pg_cron jobs with the bearer token
// inlined from env — matching the existing pupmanager-* jobs' proven
// pattern (the GUC form is privilege-blocked on Supabase). The secret
// is read from CRON_SECRET at runtime and only ever written into the
// cron.job table (same trade-off the existing jobs already accept);
// never printed, never committed.
//
// Run: tsx scripts/setup-supabase-crons.ts
import { prisma } from '../src/lib/prisma'

const BASE = 'https://app.pupmanager.com/api/cron'
const JOBS: Array<{ name: string; schedule: string; path: string }> = [
  { name: 'pm-daily-reminders', schedule: '0 6 * * *', path: 'daily-reminders' },
  { name: 'pm-evaluate-achievements', schedule: '30 18 * * *', path: 'evaluate-achievements' },
  // Hourly: the route fires per-trainer at THEIR local 8pm (training-day
  // notes reminder), so it must be evaluated every hour.
  { name: 'pm-streak-update', schedule: '0 * * * *', path: 'streak-update' },
]

async function main() {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET not in env — load .env.local first.')
    process.exit(1)
  }

  for (const j of JOBS) {
    const command = `SELECT net.http_get(url := '${BASE}/${j.path}', headers := jsonb_build_object('Authorization', 'Bearer ${secret}'))`
    await prisma.$executeRawUnsafe('SELECT cron.schedule($1, $2, $3)', j.name, j.schedule, command)
    console.log(`✓ ${j.name.padEnd(26)} ${j.schedule.padEnd(12)} → /api/cron/${j.path}`)
  }
  console.log('\nAll pm-* jobs now authenticate. Verify: tsx scripts/check-crons.ts')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
