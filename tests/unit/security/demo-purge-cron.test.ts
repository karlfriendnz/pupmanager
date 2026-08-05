import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The sweep is the cleanup path that actually runs — nobody at a stand presses
 * "exit". So it has to do two things well: pick up everything that has gone
 * quiet, and be unable to delete anything it should not.
 *
 * The second is proved by what it does NOT do when `purgeDemoTenant` refuses:
 * it never retries harder, never forces, and detaches the row so it stops
 * re-reading something it must not act on.
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  purge: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { demoSession: { findMany: h.findMany, update: h.update } },
}))

// Only purgeDemoTenant is swapped — NotADemoTenantError stays REAL, so the
// route's `instanceof` branch is exercised against the class it will actually
// meet in production rather than a stand-in that happens to match.
vi.mock('@/lib/demo-tenant', async () => {
  const actual = await vi.importActual<typeof import('@/lib/demo-tenant')>('@/lib/demo-tenant')
  return { ...actual, purgeDemoTenant: h.purge }
})

import { GET } from '@/app/api/cron/purge-demo/route'
import { NotADemoTenantError } from '@/lib/demo-tenant'

function req(secret?: string): Request {
  return new Request('https://app.pupmanager.com/api/cron/purge-demo', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  process.env.CRON_SECRET = 'the-real-secret'
  h.findMany.mockResolvedValue([])
  h.update.mockResolvedValue({})
  h.purge.mockResolvedValue({ trainerId: 't1', clientUsersDeleted: 0 })
})

describe('GET /api/cron/purge-demo — who may run it', () => {
  it('refuses a request with no bearer token', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('refuses a wrong bearer token', async () => {
    const res = await GET(req('guess'))
    expect(res.status).toBe(401)
    expect(h.purge).not.toHaveBeenCalled()
  })

  it('refuses everything when CRON_SECRET is unset, rather than letting anyone in', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req('anything'))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/cron/purge-demo — what it collects', () => {
  it('picks up ended, expired and idle sandboxes, and only ones with a tenant', async () => {
    await GET(req('the-real-secret'))
    const where = h.findMany.mock.calls[0][0].where
    expect(where.trainerId).toEqual({ not: null })
    const statuses = where.OR.map((c: { status: string }) => c.status)
    expect(statuses).toContain('ENDED')
    expect(statuses.filter((s: string) => s === 'ACTIVE')).toHaveLength(2) // expired + idle
    // One clause is the hard expiry, the other the idle window.
    expect(where.OR.some((c: Record<string, unknown>) => 'expiresAt' in c)).toBe(true)
    expect(where.OR.some((c: Record<string, unknown>) => 'lastSeenAt' in c)).toBe(true)
  })

  it('is bounded per run so one tick cannot take the database down', async () => {
    await GET(req('the-real-secret'))
    expect(h.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(50)
  })

  it('purges each candidate through the guarded function, never with a raw delete', async () => {
    h.findMany.mockResolvedValue([{ id: 'ds-1', trainerId: 't-1' }, { id: 'ds-2', trainerId: 't-2' }])
    const res = await GET(req('the-real-secret'))
    expect(h.purge).toHaveBeenCalledTimes(2)
    expect(await res.json()).toMatchObject({ ok: true, purged: 2, refused: 0 })
  })

  it('when the purge REFUSES, it detaches instead of trying harder', async () => {
    h.findMany.mockResolvedValue([{ id: 'ds-1', trainerId: 't-real-customer' }])
    h.purge.mockRejectedValue(new NotADemoTenantError('t-real-customer', 'demoSessionId is not set'))

    const res = await GET(req('the-real-secret'))
    const body = await res.json()

    expect(body.refused).toBe(1)
    expect(body.purged).toBe(0)
    // The row is taken out of the sweep's sight — it does NOT force the delete.
    const data = h.update.mock.calls[0][0].data
    expect(data.status).toBe('FAILED')
    expect(data.trainerId).toBeNull()
  })

  it('keeps going after an ordinary failure rather than stopping the sweep', async () => {
    h.findMany.mockResolvedValue([
      { id: 'ds-1', trainerId: 't-1' },
      { id: 'ds-2', trainerId: 't-2' },
    ])
    h.purge
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockResolvedValueOnce({ trainerId: 't-2', clientUsersDeleted: 0 })

    const body = await (await GET(req('the-real-secret'))).json()
    expect(body.purged).toBe(1)
    expect(body.failures).toBe(1)
  })
})
