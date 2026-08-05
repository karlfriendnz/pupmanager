import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Two invariants over EVERY api route, read from the source rather than run.
 *
 *   1. A route that changes something checks who is asking.
 *   2. A cron route checks the secret.
 *
 * Both are here because the expensive way to find these is a customer finding
 * them. The security audit found 20 of the 21 cron routes trusting
 * "Bearer undefined" — one missing check, twenty times, and nothing failed
 * until someone read them all by hand. That reading is now this file.
 *
 * Deliberately shallow: it asks whether a guard is CALLED, not whether the
 * guard is right. A wrong permission still passes. What it catches is the
 * route added in a hurry with no check at all, which is the one that has
 * actually happened here.
 */

const API = join(process.cwd(), 'src/app/api')
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'] as const

/** Anything that establishes who is asking. */
const GUARDS = [
  'guardPermission',    // trainer, with a named capability
  'getTrainerContext',  // trainer, company resolved
  'requireAdmin',       // super admin
  'getClientAccess',    // a trainer reaching one client
  'getActiveClient',    // the signed-in client (or a trainer previewing)
  'auth()',             // bare session check
  'requirePermission',  // throwing sibling of guardPermission
  'guardAnyPermission', // "any one of these capabilities"
  'getGroupAccess',     // membership of a message group
  'guardTapToPay',      // the Terminal routes, on top of a same-origin check
  // Either party to ONE booking request — the trainer whose request it is, or
  // the client who made it. Both sides negotiate a time through the same
  // endpoints, so neither `guardPermission` nor `getActiveClient` alone is the
  // check; the resolver runs both and then proves the caller is a party to that
  // row. Same shape as getGroupAccess above: a real guard, listed so this test
  // recognises it. See lib/booking-negotiation-actor and its security test.
  'resolveNegotiationActor',
]

function routeFiles(dir = API, out: { path: string; src: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { routeFiles(full, out); continue }
    if (entry !== 'route.ts') continue
    out.push({ path: full.replace(API, '').replace('/route.ts', ''), src: readFileSync(full, 'utf8') })
  }
  return out
}

/**
 * Doors that are open ON PURPOSE, and what stands in for a session at each.
 * Anything not matched here has to identify its caller.
 */
const PUBLIC_BY_DESIGN: { prefix: string; instead: string }[] = [
  { prefix: '/auth/', instead: 'signing up / logging in IS the door — rate limited instead' },
  { prefix: '/webhooks/', instead: 'verified by provider signature, not by session' },
  { prefix: '/cron/', instead: 'verified by CRON_SECRET — asserted separately below' },
  { prefix: '/c/', instead: "a trainer's public booking pages, open to strangers by design" },
  { prefix: '/pay/', instead: 'a pay link carries its own single-use token' },
  { prefix: '/form/', instead: 'a public enquiry form, open by design' },
  { prefix: '/embed-forms/', instead: 'embedded on a trainer’s own website for strangers to fill in' },
  { prefix: '/public/', instead: 'public by name' },
  { prefix: '/xero/webhook', instead: 'verified by Xero signature — a webhook that lives outside /webhooks/' },
  { prefix: '/review/', instead: "the in-app review widget, which returns 404 in production (reviewToolsEnabled) — a kill switch rather than a session, because Karl's own browser is the only caller" },
  {
    prefix: '/try/',
    instead:
      'a QR code on a trade-show poster — the caller has no account by definition, which is the whole point. ' +
      'Held instead by: rate limits on the IP AND on the lead cookie, a ceiling on live sandboxes, an httpOnly ' +
      'cookie carrying the lead id (never the request body), and the fact that everything created is a ' +
      'throwaway tenant that can send nothing and is purged within hours. /try/exit and /try/heartbeat DO ' +
      'check the session — they act on an existing sandbox — and are matched by this prefix only because ' +
      'they share it.',
  },
]

describe('every route that changes something checks who is asking', () => {
  const routes = routeFiles()

  it('found the routes at all', () => {
    expect(routes.length).toBeGreaterThan(200)
  })

  it('no mutating route is missing an identity check', () => {
    const naked: string[] = []
    for (const route of routes) {
      if (PUBLIC_BY_DESIGN.some(p => route.path.startsWith(p.prefix))) continue
      const mutates = MUTATING.some(m => route.src.includes(`export async function ${m}`))
      if (!mutates) continue
      if (GUARDS.some(g => route.src.includes(g))) continue
      naked.push(route.path)
    }
    expect(
      naked,
      `\nThis route changes something and never asks who is calling.\n\n` +
      `Add the guard the neighbouring routes use — guardPermission for trainer\n` +
      `actions, getActiveClient for client ones — or, if it really is meant to be\n` +
      `open, add its prefix to PUBLIC_BY_DESIGN with what protects it instead.\n`,
    ).toEqual([])
  })
})

describe('a route that CHANGES money is not guarded by permission to LOOK at it', () => {
  // Audit T-15. Nine routes that move money — record a payment, send an invoice,
  // combine receivables, take a sale at the counter — were guarded by
  // `billing.view`, whose label on the permissions screen reads "See the
  // subscription and billing pages".
  //
  // So an owner ticking that box to let a manager LOOK at the finances was
  // handing them the ability to change them, and nothing on screen said so. The
  // capability is split now: billing.view to read, billing.manage to write.
  //
  // The general rule, which is what this asserts: a `.view` capability never
  // guards a handler that writes. It reads per HANDLER, not per file — a route
  // with a GET on .view and a POST on .manage is exactly right.
  const routes = routeFiles()

  it('no write is protected by a read permission', () => {
    const wrong: string[] = []
    for (const route of routes) {
      let handler: string | null = null
      for (const line of route.src.split('\n')) {
        const declared = /export async function (\w+)/.exec(line)
        if (declared) handler = declared[1]
        if (!handler || !(MUTATING as readonly string[]).includes(handler)) continue
        const cap = /(?:guardPermission|requirePermission)\([^)]*'([a-z]+\.view)'/.exec(line)
        if (cap) wrong.push(`${route.path} · ${handler} guarded by ${cap[1]}`)
      }
    }
    expect(
      wrong,
      `\nThis handler changes something but only asks for permission to SEE it.\n\n` +
      `Someone given the read permission — because the label says "view" — can\n` +
      `write. Use the .manage capability for the write, and leave .view on the GET.\n`,
    ).toEqual([])
  })
})

describe('every cron route checks the secret', () => {
  // The finding this encodes: 20 of 21 accepted "Bearer undefined". A cron that
  // silently accepts anyone is a way to make the app do work — send email, take
  // money, reconcile billing — without being anybody.
  const crons = readdirSync(join(API, 'cron')).filter(d =>
    statSync(join(API, 'cron', d)).isDirectory(),
  )

  /** Crons that genuinely need no secret, and why. */
  const OPEN: Record<string, string> = {
    'keep-warm':
      'Does nothing but return 200 so the function stays warm. It reads nothing, writes nothing and sends nothing, so there is nothing to protect — and a secret would only make the warmer itself a thing that can break.',
  }

  it('found the cron routes', () => {
    expect(crons.length).toBeGreaterThan(15)
  })

  it('none of them can be triggered by a stranger', () => {
    const open = crons.filter(name => {
      if (name in OPEN) return false
      const src = readFileSync(join(API, 'cron', name, 'route.ts'), 'utf8')
      return !src.includes('CRON_SECRET')
    })
    expect(
      open,
      `\nThis cron can be triggered by anyone who knows the URL.\n\n` +
      `Check CRON_SECRET the way the others do, or add it to OPEN with the\n` +
      `reason there is nothing behind it worth protecting.\n`,
    ).toEqual([])
  })

  it('every open cron says why it is open', () => {
    for (const [name, reason] of Object.entries(OPEN)) {
      expect(crons, `${name} is in OPEN but no longer exists`).toContain(name)
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(60)
    }
  })
})
