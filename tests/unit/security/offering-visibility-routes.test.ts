import { describe, it, expect, vi, beforeEach } from 'vitest'

// An offering the trainer has held back must not be REACHABLE, not merely
// unlisted. Every one of these routes is entered with an id from the request,
// so an id the client guessed (or kept from a stale tab) is the whole attack —
// and a missed gate here is not a broken screen, it is a leak nobody notices.
//
// Each test asserts the visibility clause is actually in the `where` that goes
// to the database, because that is the only place it counts: a filter applied
// after the query has already sent the name, the price and the run ids.

const h = vi.hoisted(() => ({
  activeClient: vi.fn(),
  profileFindUnique: vi.fn(),
  pkgFindFirst: vi.fn(),
  runFindFirst: vi.fn(),
  waitlistFindFirst: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.activeClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.rateLimit, getClientIp: () => '1.1.1.1' }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.profileFindUnique },
    package: { findFirst: h.pkgFindFirst, findMany: vi.fn().mockResolvedValue([]) },
    classRun: { findFirst: h.runFindFirst },
    waitlistEntry: { findFirst: h.waitlistFindFirst, create: vi.fn() },
  },
}))

import { GET as selfBookList, POST as selfBook } from '@/app/api/my/self-book/route'
import { POST as joinWaitlist } from '@/app/api/my/waitlist/route'
import { POST as enrol } from '@/app/api/my/classes/[runId]/enroll/route'

const post = (b: unknown) =>
  new Request('https://app.pupmanager.com/x', { method: 'POST', body: JSON.stringify(b) })

/** The clause every one of these `where`s must carry. */
function assertGated(where: Record<string, unknown>) {
  expect(where.OR).toEqual([
    { visibleFrom: null },
    { visibleFrom: { lte: expect.any(Date) } },
  ])
}

/** …or, for a read that arrives through a run, on the package relation. */
function assertRelationGated(where: { package?: Record<string, unknown> }) {
  expect(where.package).toBeDefined()
  assertGated(where.package as Record<string, unknown>)
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.activeClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
  h.profileFindUnique.mockResolvedValue({
    id: 'c1', trainerId: 'co1', dogId: null,
    user: { name: 'Ana', email: 'a@x.com' },
    dog: null, trainer: { user: { id: 'u-t' } }, assignedTrainer: null,
  })
  h.rateLimit.mockResolvedValue(null)
})

describe('GET /api/my/self-book — the 1:1 list', () => {
  it('asks the database only for offerings that are showing', async () => {
    const { prisma } = await import('@/lib/prisma')
    await selfBookList()
    assertGated((prisma.package.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where)
  })
})

describe('POST /api/my/self-book — booking one by id', () => {
  it('refuses an offering that is not showing yet', async () => {
    // The gate is in the query, so a held-back offering simply is not found —
    // and the 404 says nothing about whether it exists.
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await selfBook(post({ packageId: 'p-hidden', startDate: '2099-01-01T09:00:00.000Z' }))
    expect(res.status).toBe(404)
    assertGated(h.pkgFindFirst.mock.calls[0][0].where)
  })

  it('still scopes to the caller\'s own trainer and to 1:1', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    await selfBook(post({ packageId: 'p1', startDate: '2099-01-01T09:00:00.000Z' }))
    expect(h.pkgFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'p1', trainerId: 'co1', clientSelfBook: true, isGroup: false,
    })
  })
})

describe('POST /api/my/waitlist — joining by package id', () => {
  it('cannot collect a waitlist entry against a held-back offering', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await joinWaitlist(post({ packageId: 'p-hidden' }))
    expect(res.status).toBe(404)
    assertGated(h.pkgFindFirst.mock.calls[0][0].where)
    expect(h.waitlistFindFirst).not.toHaveBeenCalled()
  })
})

describe('POST /api/my/classes/[runId]/enroll — enrolling by run id', () => {
  it('refuses a run whose offering is not showing yet', async () => {
    // This response hands back the whole package AND every ticket tier, so the
    // gate matters more here than on any list.
    h.runFindFirst.mockResolvedValue(null)
    const res = await enrol(post({ type: 'FULL' }), { params: Promise.resolve({ runId: 'r-hidden' }) })
    expect(res.status).toBe(404)
    assertRelationGated(h.runFindFirst.mock.calls[0][0].where)
  })

  it('still scopes the run to the caller\'s own trainer', async () => {
    h.runFindFirst.mockResolvedValue(null)
    await enrol(post({ type: 'FULL' }), { params: Promise.resolve({ runId: 'r1' }) })
    expect(h.runFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'r1', trainerId: 'co1' })
  })
})
