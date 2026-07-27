// Re-schedule the pm-* Supabase pg_cron jobs with the bearer token
// inlined from env — matching the existing pupmanager-* jobs' proven
// pattern (the GUC form is privilege-blocked on Supabase). The secret
// is read from CRON_SECRET at runtime and only ever written into the
// cron.job table (same trade-off the existing jobs already accept);
// never printed, never committed.
//
// Run: tsx scripts/setup-supabase-crons.ts
// scriptPrisma falls back to DIRECT_URL: .env leaves DATABASE_URL blank, so the
// app client connected to a local database named after the shell user instead
// of prod ("database 'karl' does not exist").
import { scriptPrisma } from '../src/lib/prisma-script'

const prisma = scriptPrisma()

const BASE = 'https://app.pupmanager.com/api/cron'
const JOBS: Array<{ name: string; schedule: string; path: string }> = [
  { name: 'pm-daily-reminders', schedule: '0 6 * * *', path: 'daily-reminders' },
  { name: 'pm-evaluate-achievements', schedule: '30 18 * * *', path: 'evaluate-achievements' },
  // Hourly: the route fires per-trainer at THEIR local 8pm (training-day
  // notes reminder), so it must be evaluated every hour.
  { name: 'pm-streak-update', schedule: '0 * * * *', path: 'streak-update' },
  // Client "before each session" reminders. The route dedups (ClientReminderSent),
  // so it's safe to run often — every 15 min keeps reminder times tight.
  { name: 'pm-client-session-reminders', schedule: '*/15 * * * *', path: 'client-session-reminders' },
  // These three were registered with the GUC form — Bearer ' ||
  // current_setting('app.cron_secret') — which resolves to an EMPTY token,
  // because that setting was never set and cannot be: `ALTER DATABASE postgres
  // SET app.cron_secret` returns "permission denied to set parameter" on
  // Supabase, whose postgres role is not a superuser (verified 2026-07-27).
  // So the GUC form can never work here and the inlined form is the only
  // option. Measured before this fix: 57 × 401 against 89 × 200 over 3 days.
  { name: 'pm-booking-automations', schedule: '*/15 * * * *', path: 'booking-automations' },
  { name: 'pm-google-calendar-busy-refresh', schedule: '0 */3 * * *', path: 'google-calendar-busy-refresh' },
  { name: 'pm-purge-deactivated', schedule: '15 3 * * *', path: 'purge-deactivated' },
  // These two were already returning 200s on an inlined token — but that token
  // is the OLD secret. Rotating CRON_SECRET (which is the only way to fix the
  // others, since the Production value is marked Sensitive in Vercel and cannot
  // be read back) would leave these two holding a stale token and they would
  // start failing at the next deploy. Every job that authenticates has to be
  // re-written together, or a rotation silently breaks whatever it misses.
  { name: 'pm-enquiry-followups', schedule: '0 * * * *', path: 'enquiry-followups' },
  { name: 'pm-onboarding-emails', schedule: '0 * * * *', path: 'onboarding-emails' },
  // Same again for the two older pupmanager-* jobs. Exact names matter:
  // cron.schedule() replaces by jobname, so a different prefix would create a
  // duplicate job running the same route twice rather than updating it.
  { name: 'pupmanager-daily-summary', schedule: '0 * * * *', path: 'daily-summary' },
  { name: 'pupmanager-session-reminders', schedule: '*/5 * * * *', path: 'session-reminders' },
  // Nightly at 03:40: confirm Stripe agrees with every recurring membership we
  // think is live. Catches the silent, dangerous case — a client who cancelled
  // and is still being charged because the Stripe call failed and nothing
  // errored. Registered HERE rather than anywhere else precisely because of the
  // rotation trap described above: a job outside this list gets skipped by the
  // next rotation and 401s forever with no error anywhere.
  { name: 'pm-membership-reconcile', schedule: '40 3 * * *', path: 'membership-reconcile' },
]

// Every scheduled job that sends a bearer token is in this list. That is the
// point: CRON_SECRET can only be rotated, never read back (Vercel marks the
// Production value Sensitive), so a rotation has to rewrite ALL of them at once
// or it silently breaks the ones it skips — with no error anywhere except a
// 401 buried in net._http_response. Add any new cron job here.

// cron.schedule() on an existing jobname REPLACES that job in place, so this
// script is idempotent and safe to re-run.

async function main() {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET not in env.')
    console.error('Note: `vercel env pull` writes sensitive values as EMPTY, so .env')
    console.error('will have the key with no value. Get it from Vercel → Settings →')
    console.error('Environment Variables → CRON_SECRET → Reveal.')
    process.exit(1)
  }

  // Refuse anything that looks like an unsubstituted placeholder or a stub.
  // This script REPLACES seven live production jobs, including ones that are
  // currently working — writing a bad token silently breaks all of them, and
  // there is no error at write time to notice, because cron.schedule() happily
  // stores any string. That happened twice on 2026-07-27, taking three healthy
  // jobs down. Fail loudly here instead.
  const looksFake = /[<>]|paste|your|secret_here|xxx|todo|changeme/i.test(secret) || secret.length < 16
  if (looksFake) {
    console.error(`Refusing to write CRON_SECRET: looks like a placeholder (length ${secret.length}).`)
    console.error('Paste the real value from Vercel — this would have broken all seven jobs.')
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
