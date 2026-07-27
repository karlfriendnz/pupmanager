import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// CRON_SECRET can only be ROTATED, never read back — Vercel marks the Production
// value Sensitive. So a rotation has to rewrite EVERY scheduled job at once, or
// it silently breaks the ones it skips, with no error anywhere except a 401
// buried in net._http_response.
//
// scripts/setup-supabase-crons.ts is that rotation, and its own comment claims
// "every scheduled job that sends a bearer token is in this list". On
// 2026-07-27 that was false: five jobs had been registered by MIGRATIONS rather
// than by hand, so the rotation missed all five and left them on the old
// secret. comms-flows was the visible symptom — six flow steps configured in
// production and zero sends, ever.
//
// This test is the thing that would have caught it. A migration that schedules a
// job the rotation script doesn't know about fails here, in CI, rather than
// months later as a feature that quietly never runs.

const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'setup-supabase-crons.ts')
const MIGRATIONS = join(ROOT, 'prisma', 'migrations')

/** Job names the rotation script will rewrite. */
function rotatedJobNames(): Set<string> {
  const src = readFileSync(SCRIPT, 'utf8')
  return new Set([...src.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]))
}

/** Job names any migration hands to cron.schedule(). */
function migrationJobNames(): Map<string, string> {
  const found = new Map<string, string>()
  for (const dir of readdirSync(MIGRATIONS)) {
    const file = join(MIGRATIONS, dir, 'migration.sql')
    if (!existsSync(file)) continue
    const sql = readFileSync(file, 'utf8')
    // cron.schedule( 'job-name', 'schedule', … ) — the name is the first literal
    // after the call, possibly on the following line.
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)) {
      found.set(m[1], dir)
    }
  }
  return found
}

describe('the CRON_SECRET rotation covers every scheduled job', () => {
  it('rewrites every job a migration registered', () => {
    const rotated = rotatedJobNames()
    const missing = [...migrationJobNames()]
      .filter(([job]) => !rotated.has(job))
      .map(([job, dir]) => `${job} (registered by ${dir})`)

    expect(
      missing,
      'These jobs are scheduled in production but are NOT in scripts/setup-supabase-crons.ts. ' +
        'The next CRON_SECRET rotation will leave them on the old secret and they will 401 ' +
        'silently — forever, and invisibly. Add them to JOBS with the EXACT jobname and ' +
        'schedule from the migration: cron.schedule() replaces by jobname, so a mismatch ' +
        'creates a second job on the new secret while the original keeps failing on the old.',
    ).toEqual([])
  })

  it('found some jobs to check, so a broken parser cannot pass silently', () => {
    // Without this, a regex that matches nothing makes the test above vacuously
    // green — which is the same class of bug it exists to catch.
    expect(migrationJobNames().size).toBeGreaterThan(5)
    expect(rotatedJobNames().size).toBeGreaterThan(5)
  })
})
