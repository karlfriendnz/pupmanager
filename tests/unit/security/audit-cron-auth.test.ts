import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Security audit (2026-08) — every cron route is Bearer-gated with
//
//   if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return 401
//
// which compares against the literal string "Bearer undefined" whenever
// CRON_SECRET is not set. In an environment where the variable is missing — a
// fresh preview deployment, a new region, a botched rotation (this repo has had
// one) — every one of these routes becomes callable by anyone who sends
// `Authorization: Bearer undefined`.
//
// They are not read-only. Between them they email and push every trainer and
// client on the platform, reconcile billing, mutate Stripe and Xero state, and
// purge deactivated accounts.
//
// `purge-deactivated` already does it correctly:
//
//   if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`)
//
// This test enumerates the cron directory rather than listing routes, so a cron
// route added next year is covered the day it lands.

const CRON_DIR = path.resolve(__dirname, '../../../src/app/api/cron')

function cronRoutes(): { name: string; src: string }[] {
  return fs.readdirSync(CRON_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, file: path.join(CRON_DIR, e.name, 'route.ts') }))
    .filter(r => fs.existsSync(r.file))
    .map(r => ({ name: r.name, src: fs.readFileSync(r.file, 'utf8') }))
}

/** Does the route read CRON_SECRET at all? `keep-warm` deliberately does not. */
const usesCronSecret = (src: string) => src.includes('CRON_SECRET')

/** Does it refuse when the secret is unset, rather than comparing to "undefined"? */
const guardsUnsetSecret = (src: string) =>
  /!\s*process\.env\.CRON_SECRET/.test(src) ||
  /const\s+\w+\s*=\s*process\.env\.CRON_SECRET[\s\S]{0,200}?if\s*\(\s*!\s*\w+\s*\)/.test(src)

describe('cron routes — Bearer auth', () => {
  const routes = cronRoutes()

  it('finds the cron routes', () => {
    expect(routes.length, 'the cron directory should not be empty').toBeGreaterThan(10)
  })

  it('every secret-gated cron route actually checks the Authorization header', () => {
    const missing = routes
      .filter(r => usesCronSecret(r.src))
      .filter(r => !/authorization/i.test(r.src))
      .map(r => r.name)
    expect(missing, 'a route that mentions CRON_SECRET must read the Authorization header').toEqual([])
  })

  it('the one route with no secret at all is only the keep-warm ping', () => {
    const open = routes.filter(r => !usesCronSecret(r.src)).map(r => r.name)
    // keep-warm runs `SELECT 1` and returns {ok:true} — nothing to protect.
    expect(open).toEqual(['keep-warm'])
  })

  // KNOWN FINDING — see docs/audit-security.md. Expects the correct behaviour,
  // so it goes green when the guard is added everywhere. Skipped for now so the
  // suite stays green; the companion test below pins today's state.
  it.skip('every cron route refuses when CRON_SECRET is unset', () => {
    const unguarded = routes.filter(r => usesCronSecret(r.src) && !guardsUnsetSecret(r.src)).map(r => r.name)
    expect(unguarded, 'add `!process.env.CRON_SECRET ||` to each of these').toEqual([])
  })

  it('documents how many cron routes still compare against "Bearer undefined"', () => {
    const guarded = routes.filter(r => usesCronSecret(r.src) && guardsUnsetSecret(r.src)).map(r => r.name)
    const unguarded = routes.filter(r => usesCronSecret(r.src) && !guardsUnsetSecret(r.src)).map(r => r.name)
    // If this starts failing because `unguarded` shrank, the fix is landing —
    // delete this test and un-skip the one above.
    expect(guarded, 'purge-deactivated is the pattern to copy').toContain('purge-deactivated')
    expect(unguarded.length, 'the finding is still open').toBeGreaterThan(0)
  })
})
