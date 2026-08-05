import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The public end of the trade-show flow.
 *
 * `/api/try/lead` and `/api/try/launch` are behind a QR code on a poster:
 * anyone who can point a camera can call them, and nobody signs in first. So
 * the questions here are the abuse ones — can somebody spin up thousands of
 * tenants, and can somebody end a sandbox that is not theirs.
 */

const h = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  cookies: vi.fn(),
  auth: vi.fn(),
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionCount: vi.fn(),
  createDemoTenant: vi.fn(),
  purgeDemoTenant: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: h.enforceRateLimit,
  getClientIp: () => '198.51.100.9',
}))
vi.mock('next/headers', () => ({ cookies: h.cookies }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    demoLead: { findUnique: h.leadFindUnique, update: h.leadUpdate },
    demoSession: {
      create: h.sessionCreate,
      update: h.sessionUpdate,
      updateMany: h.sessionUpdateMany,
      count: h.sessionCount,
    },
  },
}))
vi.mock('@/lib/demo-tenant', async () => {
  const actual = await vi.importActual<typeof import('@/lib/demo-tenant')>('@/lib/demo-tenant')
  return { ...actual, createDemoTenant: h.createDemoTenant, purgeDemoTenant: h.purgeDemoTenant }
})

import { POST as launch } from '@/app/api/try/launch/route'
import { POST as exit } from '@/app/api/try/exit/route'
import { NotADemoTenantError } from '@/lib/demo-tenant'
import { TRY_MAX_CONCURRENT_SANDBOXES as CEILING } from '@/lib/demo-lead'

function launchReq(body: unknown = { persona: 'groomer' }) {
  return new Request('https://app.pupmanager.com/api/try/launch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function withLeadCookie(value?: string) {
  h.cookies.mockResolvedValue({ get: (k: string) => (k === 'pm-try-lead' && value ? { value } : undefined) })
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.enforceRateLimit.mockResolvedValue(null)
  withLeadCookie('lead-1')
  h.leadFindUnique.mockResolvedValue({ id: 'lead-1', name: 'Jess', companyName: 'Carter Canine' })
  h.leadUpdate.mockResolvedValue({})
  h.sessionCount.mockResolvedValue(0)
  h.sessionCreate.mockResolvedValue({ id: 'ds-1' })
  h.sessionUpdate.mockResolvedValue({})
  h.sessionUpdateMany.mockResolvedValue({ count: 1 })
  h.createDemoTenant.mockResolvedValue({ trainerId: 't-demo', ownerUserId: 'u-demo' })
})

describe('POST /api/try/launch — abuse control', () => {
  it('will not build a tenant without the httpOnly lead cookie', async () => {
    // A lead id in a request body is a lead id anybody can type.
    withLeadCookie(undefined)
    const res = await launch(launchReq())
    expect(res.status).toBe(401)
    expect(h.createDemoTenant).not.toHaveBeenCalled()
  })

  it('limits per IP AND per lead — two different questions', async () => {
    await launch(launchReq())
    const keys = h.enforceRateLimit.mock.calls.map(c => c[0].key)
    expect(keys.some((k: string) => k.startsWith('try-launch:'))).toBe(true)
    expect(keys.some((k: string) => k.startsWith('try-launch-lead:'))).toBe(true)
  })

  it('stops at the rate limit before creating anything', async () => {
    h.enforceRateLimit.mockResolvedValueOnce(new Response('too many', { status: 429 }))
    const res = await launch(launchReq())
    expect(res.status).toBe(429)
    expect(h.sessionCreate).not.toHaveBeenCalled()
    expect(h.createDemoTenant).not.toHaveBeenCalled()
  })

  it('refuses once the live-sandbox ceiling is reached, rather than making tenant 4000', async () => {
    h.sessionCount.mockResolvedValue(CEILING)
    const res = await launch(launchReq())
    expect(res.status).toBe(503)
    expect(h.createDemoTenant).not.toHaveBeenCalled()
  })

  it('leaves headroom above the 30 concurrent visitors Karl asked for', () => {
    expect(CEILING).toBeGreaterThanOrEqual(30)
  })

  it('refuses a persona that is not in the catalog', async () => {
    const res = await launch(launchReq({ persona: 'wizard' }))
    expect(res.status).toBe(400)
    expect(h.createDemoTenant).not.toHaveBeenCalled()
  })

  it('creates the session row BEFORE the tenant, so no tenant is ever unpurgeable', async () => {
    await launch(launchReq())
    const sessionOrder = h.sessionCreate.mock.invocationCallOrder[0]
    const tenantOrder = h.createDemoTenant.mock.invocationCallOrder[0]
    expect(sessionOrder).toBeLessThan(tenantOrder)
  })

  it('hands back a token that is not the one stored — only its hash is kept', async () => {
    const res = await launch(launchReq())
    const body = await res.json()
    const stored = h.sessionUpdate.mock.calls[0][0].data.entryTokenHash
    expect(body.token).toBeTruthy()
    expect(stored).toBeTruthy()
    expect(stored).not.toBe(body.token)
  })

  it('gives the token a short life', async () => {
    await launch(launchReq())
    const expires: Date = h.sessionUpdate.mock.calls[0][0].data.entryTokenExpires
    expect(expires.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000)
  })

  it('keeps the LEAD when seeding blows up — the marketing record is the point', async () => {
    h.createDemoTenant.mockRejectedValue(new Error('database on fire'))
    const res = await launch(launchReq())
    expect(res.status).toBe(500)
    // The visit is marked failed; nothing deletes the lead.
    expect(h.sessionUpdate.mock.calls[0][0].data.status).toBe('FAILED')
  })
})

describe('POST /api/try/exit — you can only end your own sandbox', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await exit()
    expect(res.status).toBe(401)
    expect(h.purgeDemoTenant).not.toHaveBeenCalled()
  })

  it('refuses a REAL trainer — a signed-in customer cannot use this to delete themselves', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-real', trainerId: 't-real' } })
    const res = await exit()
    expect(res.status).toBe(403)
    expect(h.purgeDemoTenant).not.toHaveBeenCalled()
  })

  it('purges the tenant named by the SESSION, never one named by the caller', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-demo', trainerId: 't-demo', isDemo: true } })
    h.purgeDemoTenant.mockResolvedValue({ trainerId: 't-demo', clientUsersDeleted: 2 })
    const res = await exit()
    expect(res.status).toBe(200)
    expect(h.purgeDemoTenant.mock.calls[0][1]).toBe('t-demo')
  })

  it('refuses loudly when the session says demo and the tenant disagrees', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u', trainerId: 't-real', isDemo: true } })
    h.purgeDemoTenant.mockRejectedValue(new NotADemoTenantError('t-real', 'demoSessionId is not set'))
    const res = await exit()
    expect(res.status).toBe(403)
  })

  it('marks the visit ended before deleting, so the sweep still collects a failed delete', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-demo', trainerId: 't-demo', isDemo: true } })
    h.purgeDemoTenant.mockRejectedValue(new Error('deadlock'))
    const res = await exit()
    expect(h.sessionUpdateMany.mock.calls[0][0].data.status).toBe('ENDED')
    expect(await res.json()).toMatchObject({ ok: true, deferred: true })
  })
})
