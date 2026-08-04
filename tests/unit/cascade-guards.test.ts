import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ONE test, every delete route, no fixtures and no browser.
 *
 * Three of the 2026-08-04 bugs (T-5, T-7, T-8) were found by reading
 * `schema.prisma` for `onDelete: Cascade` and asking "what does deleting the
 * parent destroy?" — not by running anything. That reading is mechanical, so it
 * belongs in a test rather than in whoever happens to look:
 *
 *   T-5 · deleting a package destroyed the purchases of everyone on it,
 *         live Stripe subscriptions and all
 *   T-7 · deleting a product destroyed the orders behind it
 *   T-8 · deleting a session form destroyed every answer filled in on it
 *
 * The rule this encodes: **if deleting X cascades into something that is money,
 * or something a person wrote or paid for, the route that deletes X must check
 * first.** House answer is a 409 that names the alternative — unpublish, hide,
 * turn off.
 *
 * Being schema-driven, it covers routes nobody has thought about yet, including
 * ones added next year.
 *
 * LIMIT, stated plainly: it follows ONE hop. Deleting A → cascades B → cascades
 * C is not chased, so a second-order destruction can still slip past.
 */

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const API = join(process.cwd(), 'src/app/api')

/**
 * Rows that must not disappear because something above them was deleted:
 * money, or a record of what a person did, said, bought or was asked.
 */
const PRECIOUS: Record<string, string> = {
  Invoice: 'money owed',
  InvoiceLineItem: 'what the money was for',
  Payment: 'money taken',
  PaymentItem: 'what the money was for',
  MembershipPurchase: 'what someone bought, and their live subscription',
  ProductRequest: 'an order placed, and the record of one fulfilled',
  ClassEnrollment: 'a seat someone holds and was billed for',
  SessionFormResponse: 'answers recorded at a session',
  TrainingLog: 'what an owner did with their dog',
  TimeEntry: 'hours someone is owed for',
  SessionTimeEntry: 'hours worked on a session',
  ClientShare: 'who else can see a client',
}

/** child model → the models whose deletion cascades it away. */
function cascadeParents(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  let current = ''
  for (const line of SCHEMA.split('\n')) {
    const model = /^model (\w+) \{/.exec(line)
    if (model) { current = model[1]; continue }
    if (!current) continue
    // e.g.  membership  Membership  @relation(fields: [membershipId], references: [id], onDelete: Cascade)
    const rel = /^\s+\w+\s+(\w+)\??\s+@relation\([^)]*onDelete:\s*Cascade/.exec(line)
    if (!rel) continue
    if (!out.has(current)) out.set(current, new Set())
    out.get(current)!.add(rel[1])
  }
  return out
}

/** Every route.ts that exports DELETE, with its source. */
function deleteRoutes(dir = API, out: { path: string; src: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { deleteRoutes(full, out); continue }
    if (entry !== 'route.ts') continue
    const src = readFileSync(full, 'utf8')
    if (!/export async function DELETE/.test(src)) continue
    out.push({ path: full.replace(API, '').replace('/route.ts', ''), src })
  }
  return out
}

const camel = (model: string) => model[0].toLowerCase() + model.slice(1)

/** The DELETE half of a route file, which is the only part this asks about. */
const deleteBody = (src: string) => src.slice(src.indexOf('export async function DELETE'))

/**
 * Routes that delete a cascade-parent WITHOUT checking first — each with the
 * reason it is allowed to. Anything not listed here must guard.
 */
const ALLOWED: Record<string, string> = {
  '/admin/trainers/[trainerId]':
    'Deleting a whole business is meant to take its records with it — that IS the request, and it is admin-only.',
  '/clients/[clientId]':
    'Same: removing a client removes their history on purpose. Guarded by a primary-trainer check instead.',
  '/dogs/[dogId]':
    'A dog carries sessions and logs, and removing it is meant to take them. Owner-scoped.',
  '/clients/[clientId]/dogs/[dogId]':
    'As above, scoped to one client.',
  '/message-groups/[groupId]':
    'Deleting a conversation is meant to take its messages — that is what the trainer asked for.',
}

/**
 * KNOWN GAPS — real bugs, deliberately not fixed yet, with the reason.
 *
 * Separate from ALLOWED on purpose. ALLOWED means "deleting really is meant to
 * take it"; this means "this is wrong and we know". Keeping them apart is what
 * stops an allow list quietly becoming the place bugs go to be forgotten.
 */
const KNOWN_GAPS: Record<string, string> = {
  '/trainer/team/[membershipId]':
    'T-11 · removing a staff member cascades their SessionTimeEntry rows, so the hours they worked — and the rate they were owed — go with them. The right fix is a schema change (membershipId optional + SetNull) so the record of the work outlives the person leaving; refusing to remove staff would be worse than the bug. Parked because Timesheets was withdrawn on 2026-08-05 and nothing currently reads these rows. Fix it before Timesheets comes back.',
}

describe('a delete that destroys money or history has to check first', () => {
  const parents = cascadeParents()
  const routes = deleteRoutes()

  it('reads the schema and the routes at all', () => {
    expect(parents.size).toBeGreaterThan(20)
    expect(routes.length).toBeGreaterThan(50)
  })

  it('knows what deleting each precious row destroys', () => {
    // If a model in PRECIOUS stops existing, this list is stale and the whole
    // test quietly stops checking anything.
    for (const model of Object.keys(PRECIOUS)) {
      expect(SCHEMA, `${model} is in PRECIOUS but not in the schema`).toContain(`model ${model} {`)
    }
  })

  it('every unguarded delete of a cascade parent is either safe or listed', () => {
    // Which models, if deleted, take something precious with them.
    const dangerous = new Map<string, string[]>()
    for (const [child, reason] of Object.entries(PRECIOUS)) {
      for (const parent of parents.get(child) ?? []) {
        if (!dangerous.has(parent)) dangerous.set(parent, [])
        dangerous.get(parent)!.push(`${child} (${reason})`)
      }
    }

    const unguarded: string[] = []
    for (const route of routes) {
      if (route.path in ALLOWED || route.path in KNOWN_GAPS) continue
      const body = deleteBody(route.src)
      // A guard is any refusal or any counting before the delete. Deliberately
      // generous — this is here to catch the route that checks NOTHING.
      const guards = /\b409\b|\.count\(|findMany\(|findFirst\(/.test(body)
      if (guards) continue

      for (const [model, destroys] of dangerous) {
        const deletesIt = new RegExp(`\\b${camel(model)}\\.delete(Many)?\\(`).test(body)
        if (deletesIt) {
          unguarded.push(`${route.path} deletes ${model}, which destroys: ${destroys.join(', ')}`)
        }
      }
    }

    expect(
      unguarded,
      `\nThis delete destroys money or history and checks nothing first.\n\n` +
      `Ask what the matching create did. If the answer is "took payment" or\n` +
      `"recorded what someone said", the route has to refuse — a 409 naming the\n` +
      `way out (unpublish, hide, turn it off). That is audit T-5, T-7 and T-8.\n\n` +
      `If deleting really is meant to take it, add the route to ALLOWED with the reason.\n`,
    ).toEqual([])
  })

  it('neither list has stale entries', () => {
    const paths = new Set(routes.map(r => r.path))
    expect(
      Object.keys(ALLOWED).filter(p => !paths.has(p)),
      'these routes are gone — drop them from ALLOWED',
    ).toEqual([])
    expect(
      Object.keys(KNOWN_GAPS).filter(p => !paths.has(p)),
      'these routes are gone — drop them from KNOWN_GAPS',
    ).toEqual([])
  })

  it('every known gap says what is wrong and why it is still open', () => {
    // A one-word excuse is how a gap becomes permanent.
    for (const [route, reason] of Object.entries(KNOWN_GAPS)) {
      expect(reason.length, `${route} needs a real reason, not a shrug`).toBeGreaterThan(80)
    }
  })
})
