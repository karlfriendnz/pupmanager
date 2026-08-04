import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Does each route ask for the permission its AREA is about?
 *
 * `route-guards.test.ts` asks whether a guard is called at all, and whether a
 * read permission is guarding a write (audit T-15). This asks the next question
 * down: is it the RIGHT capability. A finances route guarded by
 * `packages.manage` passes both of the other tests and is still wrong — the
 * owner who unticked "Manage billing" would find it made no difference.
 *
 * Nothing here is clever. It is the mapping written down, so that changing it
 * has to be deliberate: a copy-pasted route that keeps the guard it was copied
 * from now fails instead of quietly widening who can do something.
 */

const API = join(process.cwd(), 'src/app/api')

function routeFiles(dir = API, out: { path: string; src: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { routeFiles(full, out); continue }
    if (entry !== 'route.ts') continue
    out.push({ path: full.replace(API, '').replace('/route.ts', ''), src: readFileSync(full, 'utf8') })
  }
  return out
}

/** Every capability a route names, however it names it. */
function capabilities(src: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /guardPermission\('([a-z.]+)'/g,
    /requirePermission\('([a-z.]+)'/g,
    /requirePermission\([^,]+,\s*'([a-z.]+)'/g,
    /guardAnyPermission\(\[([^\]]*)\]/g,
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      for (const cap of m[1].split(',')) {
        const clean = cap.trim().replace(/['"]/g, '')
        if (/^[a-z]+\.[a-zA-Z]+$/.test(clean)) found.add(clean)
      }
    }
  }
  return [...found]
}

/**
 * Area → the capabilities a route in it may ask for. First match wins, so put
 * the more specific prefix first.
 */
const AREAS: { prefix: string; allow: string[]; why: string }[] = [
  { prefix: '/trainer/finances', allow: ['billing.view', 'billing.manage'], why: 'money' },
  { prefix: '/trainer/team', allow: ['team.manage', 'billing.seats'], why: 'who works here' },
  { prefix: '/trainer/memberships', allow: ['packages.manage'], why: 'packages are offerings' },
  { prefix: '/trainer/packages', allow: ['packages.manage'], why: 'offerings' },
  { prefix: '/trainer/class-runs', allow: ['classes.manage'], why: 'classes' },
  { prefix: '/trainer/daycare', allow: ['classes.manage'], why: 'daycare runs like a class' },
  { prefix: '/trainer/lead-magnets', allow: ['forms.manage'], why: 'a lead magnet is a form' },
  { prefix: '/class-runs', allow: ['classes.manage', 'packages.manage', 'billing.manage'], why: 'classes, and the invoice one enrolment raises' },
  { prefix: '/packages', allow: ['packages.manage'], why: 'offerings' },
  { prefix: '/products', allow: ['products.manage'], why: 'the shop' },
  { prefix: '/achievements', allow: ['achievements.manage'], why: 'badges' },
  { prefix: '/enquiries', allow: ['enquiries.manage'], why: 'the inbox' },
  { prefix: '/messages', allow: ['messages.send'], why: 'messaging' },
  { prefix: '/message-groups', allow: ['messages.send'], why: 'messaging' },
  { prefix: '/clients', allow: ['clients.edit', 'clients.invite', 'messages.send'], why: 'client records, and mailing them' },
  { prefix: '/library', allow: ['forms.manage', 'clients.edit'], why: 'the homework library, and assigning it to a client' },
  { prefix: '/embed-forms', allow: ['forms.manage'], why: 'forms' },
  { prefix: '/session-forms', allow: ['forms.manage'], why: 'forms' },
  { prefix: '/ai', allow: ['ai.use'], why: 'the AI tools' },
]

/**
 * Routes whose guard does NOT match their area, each with the reason it is
 * allowed to. A short reason is not a reason — a test below checks that.
 */
const EXCEPTIONS: Record<string, string> = {
  '/trainer/discounts': DISCOUNT_REASON(),
  '/trainer/discounts/[id]': DISCOUNT_REASON(),
}

function DISCOUNT_REASON() {
  return (
    'OPEN QUESTION for Karl, not a settled decision. A Discount carries a ' +
    'modifier applied to `order_total`, so it reduces what a client pays across ' +
    'an order — but both routes guard with `classes.manage`, which every MANAGER ' +
    'holds by default. So anyone who can run classes can write a rule that ' +
    'lowers what people are charged, and an owner who unticked the billing ' +
    'permissions would never know. It is not the T-15 shape (classes.manage IS ' +
    'a write capability, so nobody is getting more than "manage" implies) and ' +
    'changing it would lock managers out of something they may legitimately do ' +
    'today, which is why it is recorded here rather than quietly moved to ' +
    'billing.manage.'
  )
}

describe('a route asks for the permission its area is about', () => {
  const routes = routeFiles()

  it('found routes with guards at all', () => {
    expect(routes.filter(r => capabilities(r.src).length > 0).length).toBeGreaterThan(50)
  })

  it('no route is guarded by a capability from somewhere else', () => {
    const mismatched: string[] = []
    for (const route of routes) {
      if (route.path in EXCEPTIONS) continue
      const caps = capabilities(route.src)
      if (caps.length === 0) continue
      const area = AREAS.find(a => route.path.startsWith(a.prefix))
      if (!area) continue
      const wrong = caps.filter(c => !area.allow.includes(c))
      if (wrong.length) {
        mismatched.push(`${route.path} (${area.why}) asks for ${wrong.join(', ')} — expected one of ${area.allow.join(', ')}`)
      }
    }
    expect(
      mismatched,
      `\nThis route asks for a permission belonging to a different part of the app.\n\n` +
      `Usually a copy-paste: the new route kept the guard of the one it was\n` +
      `copied from, which quietly widens who can do it. Use the capability for\n` +
      `its own area, or add the route to EXCEPTIONS with the reason.\n`,
    ).toEqual([])
  })

  it('every exception explains itself properly', () => {
    for (const [route, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length, `${route} needs a real reason, not a shrug`).toBeGreaterThan(120)
    }
  })
})
