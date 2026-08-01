import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST/DELETE /api/my/memberships/[membershipId]/request — a client asking for
// a package they can't check out themselves.
//
// Security/behaviour focus: auth, the Memberships add-on gate, tenant scoping
// (a membership id belonging to another trainer must 404, not leak a name), the
// "only what checkout refuses" rule (so Request can never be used to skip
// paying), idempotency (one notification per client per package), and the
// trainer-in-preview carve-out.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  requestFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  requestDeleteMany: vi.fn(),
  hasAddon: vi.fn(),
  notifyTrainer: vi.fn(),
  enforceRateLimit: vi.fn(),
  checkEligibility: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    membership: { findFirst: h.membershipFindFirst },
    membershipRequest: { findFirst: h.requestFindFirst, create: h.requestCreate, deleteMany: h.requestDeleteMany },
  },
}))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
// The eligibility RULE has its own suite (membership-eligibility.test.ts);
// what matters here is that this route consults it and refuses when it says no.
vi.mock('@/lib/membership-eligibility', () => ({
  checkEligibility: h.checkEligibility,
  describeMissing: vi.fn(async () => []),
}))

import { POST, DELETE } from '@/app/api/my/memberships/[membershipId]/request/route'

const PARAMS = { params: Promise.resolve({ membershipId: 'm1' }) }
const req = () => new Request('https://app.pupmanager.com/api/my/memberships/m1/request', { method: 'POST' })

function signedIn({ isPreview = false } = {}) {
  h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview })
  h.clientFindUnique.mockResolvedValue({
    id: 'c1', trainerId: 't1',
    user: { name: 'Will Evans' }, dog: { name: 'Scout' },
    trainer: { user: { id: 'trainer-user' } }, assignedTrainer: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  h.hasAddon.mockResolvedValue(true)
  h.requestFindFirst.mockResolvedValue(null)
  h.requestCreate.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'req1', ...(data as object) }))
  h.notifyTrainer.mockResolvedValue(undefined)
  h.checkEligibility.mockResolvedValue({ eligible: true, lockedReason: null, missing: [] })
})

describe('POST /api/my/memberships/[id]/request', () => {
  it('403s a package the client is not eligible for — asking is not a way past the ladder', async () => {
    // Without this, "Request this" is a route around eligibility: the request
    // reaches the trainer looking like any other, and a trainer working through
    // their list might simply accept it.
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1', user: { name: 'Sam' }, dog: { name: 'Bo' }, trainer: { user: { id: 'u_t' } }, assignedTrainer: null })
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Seniors', priceCents: 0, cadence: 'RECURRING', eligibility: 'ACHIEVEMENT' })
    h.checkEligibility.mockResolvedValue({ eligible: false, lockedReason: 'ACHIEVEMENT', missing: ['a1'] })

    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(403)
    expect(h.requestCreate).not.toHaveBeenCalled()
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })

  it('401s a caller with no client context', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await POST(req(), PARAMS)).status).toBe(401)
    expect(h.requestCreate).not.toHaveBeenCalled()
  })

  it('404s when the trainer has the Memberships add-on switched off', async () => {
    signedIn()
    h.hasAddon.mockResolvedValue(false)
    expect((await POST(req(), PARAMS)).status).toBe(404)
    expect(h.membershipFindFirst).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the client’s own trainer and published rows', async () => {
    signedIn()
    h.membershipFindFirst.mockResolvedValue(null)
    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(404)
    expect(h.membershipFindFirst.mock.calls[0][0].where).toEqual({ id: 'm1', trainerId: 't1', published: true })
    expect(h.requestCreate).not.toHaveBeenCalled()
  })

  it('409s something checkout WOULD take — Request must not be a way to skip paying', async () => {
    signedIn()
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Starter', priceCents: 12000, cadence: 'ONE_OFF' })
    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(409)
    expect(h.requestCreate).not.toHaveBeenCalled()
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })

  it('records a recurring plan with reason RECURRING and tells the trainer', async () => {
    signedIn()
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING' })
    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(201)
    expect(h.requestCreate.mock.calls[0][0].data).toEqual({
      clientId: 'c1', membershipId: 'm1', reason: 'RECURRING', status: 'PENDING',
    })
    const [userId, type, vars] = h.notifyTrainer.mock.calls[0]
    expect(userId).toBe('trainer-user')
    // No new notification type — CLIENT_SHOP_ORDER already means "a client
    // bought or requested one of your products".
    expect(type).toBe('CLIENT_SHOP_ORDER')
    expect(vars.detail).toContain('ongoing plan')
    expect(vars.detail).toContain('Juniors')
  })

  it('records an unpriced package with reason NO_PRICE, worded as a different job', async () => {
    signedIn()
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Mystery', priceCents: 0, cadence: 'ONE_OFF' })
    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(201)
    expect(h.requestCreate.mock.calls[0][0].data.reason).toBe('NO_PRICE')
    expect(h.notifyTrainer.mock.calls[0][2].detail).toContain('no price')
    expect(h.notifyTrainer.mock.calls[0][2].detail).not.toContain('ongoing plan')
  })

  it('is a no-op on a repeat tap — one row, and the trainer is told once', async () => {
    signedIn()
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING' })
    h.requestFindFirst.mockResolvedValue({ id: 'req1', clientId: 'c1', membershipId: 'm1', status: 'PENDING' })

    const res = await POST(req(), PARAMS)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, alreadyRequested: true })
    expect(h.requestCreate).not.toHaveBeenCalled()
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })

  it('does not notify a trainer who is previewing their own client app', async () => {
    signedIn({ isPreview: true })
    h.membershipFindFirst.mockResolvedValue({ id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING' })

    expect((await POST(req(), PARAMS)).status).toBe(201)
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })

  it('honours the rate limiter', async () => {
    signedIn()
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await POST(req(), PARAMS)).status).toBe(429)
    expect(h.membershipFindFirst).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/my/memberships/[id]/request', () => {
  it('only ever clears the caller’s own pending row', async () => {
    signedIn()
    h.requestDeleteMany.mockResolvedValue({ count: 1 })

    expect((await DELETE(req(), PARAMS)).status).toBe(200)
    expect(h.requestDeleteMany.mock.calls[0][0].where).toEqual({
      clientId: 'c1', membershipId: 'm1', status: 'PENDING',
    })
  })

  it('401s without a client context', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await DELETE(req(), PARAMS)).status).toBe(401)
    expect(h.requestDeleteMany).not.toHaveBeenCalled()
  })
})
