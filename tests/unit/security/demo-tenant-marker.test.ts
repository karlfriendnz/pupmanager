import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The marker that says "this tenant is a throwaway trade-show sandbox" is the
 * thing every safety rail keys off — the outbound block, the billing refusals,
 * the purge. It must be impossible to set on a real business.
 *
 * The argument has three legs and this file tests all three:
 *   1. `createDemoTenant` is the only writer, and it always writes BOTH columns.
 *   2. The trainer-profile PATCH route validates against a zod allow-list that
 *      contains neither column, so a crafted body is inert.
 *   3. The owner login sits on a reserved `.test` domain a real account cannot
 *      have (that leg is covered in demo-purge-safety.test.ts).
 */

const h = vi.hoisted(() => ({
  userCreate: vi.fn(),
  profileCreate: vi.fn(),
  membershipCreate: vi.fn(),
  progressUpsert: vi.fn(),
  seedDemoData: vi.fn(),
  // profile-route side
  guardPermission: vi.fn(),
  profileUpdate: vi.fn(),
  profileFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('@/lib/demo-seed', () => ({ seedDemoData: h.seedDemoData, resetDemoData: vi.fn(async () => ({})) }))

import { DEMO_CLIENT_COUNT, DEMO_PERSONA_IDS, createDemoTenant } from '@/lib/demo-tenant'
import { PERSONAS } from '@/lib/onboarding-recommendations'

const prisma = {
  user: { create: h.userCreate },
  trainerProfile: { create: h.profileCreate },
  trainerMembership: { create: h.membershipCreate },
  trainerOnboardingProgress: { upsert: h.progressUpsert },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const ARGS = {
  sessionId: 'ds-42',
  visitorName: 'Jess Carter',
  companyName: 'Carter Canine',
  persona: 'groomer',
  expiresAt: new Date('2026-08-06T12:00:00Z'),
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.userCreate.mockResolvedValue({ id: 'u-demo' })
  h.profileCreate.mockResolvedValue({ id: 't-demo' })
  h.membershipCreate.mockResolvedValue({})
  h.progressUpsert.mockResolvedValue({})
  h.seedDemoData.mockResolvedValue({})
})

describe('the persona list is the real catalog, not a copy of it', () => {
  it('is exactly TrainerProfile.businessRoles\' persona ids', () => {
    // AGENTS.md #10: a hard-coded parallel list rots. The picker, the seeder and
    // the tenant all read the same array.
    expect(DEMO_PERSONA_IDS).toEqual(PERSONAS.map(p => p.id))
    expect(DEMO_PERSONA_IDS).toContain('groomer')
    expect(DEMO_PERSONA_IDS).toContain('walker')
  })
})

describe('createDemoTenant — the only writer of the marker', () => {
  it('writes BOTH marker columns, so a half-marked tenant cannot exist', async () => {
    await createDemoTenant(prisma, ARGS)
    const data = h.profileCreate.mock.calls[0][0].data
    expect(data.demoSessionId).toBe('ds-42')
    expect(data.demoExpiresAt).toEqual(ARGS.expiresAt)
  })

  it('puts the owner login on the reserved, unmailable .test domain', async () => {
    await createDemoTenant(prisma, ARGS)
    const email = h.userCreate.mock.calls[0][0].data.email as string
    expect(email).toMatch(/@try\.pupmanager\.test$/)
    expect(email).toContain('ds-42')
  })

  it('flags it internal and sandbox-billing so it stays out of real numbers and live Stripe', async () => {
    await createDemoTenant(prisma, ARGS)
    const data = h.profileCreate.mock.calls[0][0].data
    expect(data.isInternal).toBe(true)
    expect(data.sandboxBilling).toBe(true)
  })

  it('fills name, business and phone so the profile gate never stops a stranger at a form', async () => {
    await createDemoTenant(prisma, ARGS)
    expect(h.userCreate.mock.calls[0][0].data.name).toBe('Jess Carter')
    const data = h.profileCreate.mock.calls[0][0].data
    expect(data.businessName).toBe('Carter Canine')
    expect(data.phone).toBeTruthy()
  })

  it('turns off the user\'s own notification channels as well', async () => {
    const data = h.userCreate.mock.calls.length
      ? h.userCreate.mock.calls[0][0].data
      : (await createDemoTenant(prisma, ARGS), h.userCreate.mock.calls[0][0].data)
    expect(data.notifyEmail).toBe(false)
    expect(data.notifyPush).toBe(false)
  })

  it('seeds through the EXISTING persona-aware seeder, so a groomer sees grooms', async () => {
    await createDemoTenant(prisma, ARGS)
    expect(h.seedDemoData).toHaveBeenCalledTimes(1)
    const [, trainerId, opts] = h.seedDemoData.mock.calls[0]
    expect(trainerId).toBe('t-demo')
    expect(opts.roles).toEqual(['groomer'])
    expect(opts.clientCount).toBe(DEMO_CLIENT_COUNT)
    expect(opts.markSample).toBe(true)
  })

  it('records the persona on businessRoles so the whole app tailors itself', async () => {
    await createDemoTenant(prisma, ARGS)
    expect(h.profileCreate.mock.calls[0][0].data.businessRoles).toEqual(['groomer'])
  })

  it('refuses a persona that is not in the catalog, before creating anything', async () => {
    await expect(createDemoTenant(prisma, { ...ARGS, persona: 'hacker' }))
      .rejects.toThrow(/unknown persona/)
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.profileCreate).not.toHaveBeenCalled()
  })

  it('gives the sandbox an OWNER membership — it is a normal tenant in every way', async () => {
    await createDemoTenant(prisma, ARGS)
    const data = h.membershipCreate.mock.calls[0][0].data
    expect(data.companyId).toBe('t-demo')
    expect(data.role).toBe('OWNER')
  })
})

/**
 * A DRIFT test, not a snapshot of today's code.
 *
 * "Only createDemoTenant writes the marker" is the load-bearing claim behind
 * every safety rail, and it is the kind of claim that quietly stops being true
 * the day somebody adds a convenient admin toggle. So rather than assert what
 * one route does right now, this walks the source and enforces the rule itself:
 * outside `lib/demo-tenant.ts`, these columns may only be READ.
 *
 * A Prisma read of a column looks like `demoSessionId: true` (a select) or
 * `demoSessionId: null` / `{ not: null }` (a filter). Anything else in that
 * position is a write, and fails here with the file named.
 */
describe('the marker cannot be set from outside', () => {
  const WRITER = 'src/lib/demo-tenant.ts'

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'generated' || entry.name === 'node_modules') continue
        walk(full, out)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  const files = walk('src').filter(f => f !== WRITER)

  it('is only ever READ outside lib/demo-tenant.ts', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\bdemo(?:SessionId|ExpiresAt)\s*:\s*([^,\n}]+)/g)) {
        const value = m[1].trim()
        const isRead = value === 'true' || value === 'null' || value.startsWith('{')
        if (!isRead) offenders.push(`${file}: ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('names lib/demo-tenant.ts as the writer, so the rule has somewhere to point', () => {
    const src = readFileSync(WRITER, 'utf8')
    expect(src).toContain('demoSessionId: args.sessionId')
    expect(src).toContain('demoExpiresAt: args.expiresAt')
  })
})
