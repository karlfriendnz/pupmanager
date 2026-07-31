import { describe, it, expect, vi, beforeEach } from 'vitest'

// Converting between the three group kinds — class, casual class, event.
//
// They are the same two rows (ClassRun + Package) wearing different declared
// flags, so this is cheap in a way the old class → 1:1 conversion was not. What
// it must get right is the refusals, because each one guards something that
// cannot be undone by re-converting:
//
//   * people booked in           — a roster should be cancelled, not dissolved
//   * anyone already INVOICED    — money moved for the thing it used to be
//   * a multi-session → event    — an event is ONE occasion, so six sessions
//                                  become five deletions or six prices
//
// And the flags must be SET, never inferred: run-kind.ts records that inferring
// "event" from shape once cost a customer 55 of her 63 classes off screen.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  runFindFirst: vi.fn(),
  transaction: vi.fn(),
  pkgUpdate: vi.fn(),
  tierDeleteMany: vi.fn(),
  slotDeleteMany: vi.fn(),
  slotCreate: vi.fn(),
  slotCount: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: { classRun: { findFirst: h.runFindFirst }, $transaction: h.transaction },
}))

import { POST } from '@/app/api/class-runs/[runId]/convert/route'

const tx = {
  package: { update: h.pkgUpdate },
  packageTicketTier: { deleteMany: h.tierDeleteMany },
  packageSessionSlot: { deleteMany: h.slotDeleteMany, create: h.slotCreate, count: h.slotCount },
}

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    packageId: 'pkg_1',
    startDate: new Date('2026-08-06T19:00:00Z'),
    package: {
      id: 'pkg_1', name: 'Reactive Rover', isEvent: false, allowDropIn: false,
      isPuppySchool: false, priceCents: 72000, sessionCount: 6, durationMins: 60,
    },
    sessions: [{ id: 's1', scheduledAt: new Date('2026-08-06T19:00:00Z'), durationMins: 60 }],
    enrollments: [],
    ...over,
  }
}

const call = (to: string) =>
  POST(
    new Request('http://localhost/api/class-runs/run_1/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    }),
    { params: Promise.resolve({ runId: 'run_1' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ trainerId: 't1' })
  h.auth.mockResolvedValue({ user: { trainerId: 't1' } })
  h.transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  h.slotCount.mockResolvedValue(0)
})

describe('refusals', () => {
  it('refuses while anyone is booked in', async () => {
    h.runFindFirst.mockResolvedValue(run({
      enrollments: [{ id: 'e1', status: 'ENROLLED', invoicedAt: null }],
    }))

    const res = await call('event')

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('booked in') })
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('refuses when someone was INVOICED, even after withdrawing', async () => {
    // The gap this closes: the live-enrolment check passes, because they left —
    // but they were billed for the thing it used to be.
    h.runFindFirst.mockResolvedValue(run({
      enrollments: [{ id: 'e1', status: 'WITHDRAWN', invoicedAt: new Date() }],
    }))

    const res = await call('event')

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('invoiced') })
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('refuses to turn a multi-session class into one event', async () => {
    h.runFindFirst.mockResolvedValue(run({
      sessions: [{ id: 's1', scheduledAt: new Date(), durationMins: 60 }, { id: 's2', scheduledAt: new Date(), durationMins: 60 }],
    }))

    const res = await call('event')

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('single occasion') })
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('refuses converting something to what it already is', async () => {
    h.runFindFirst.mockResolvedValue(run())
    const res = await call('class')
    expect(res.status).toBe(409)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('refuses daycare outright', async () => {
    h.runFindFirst.mockResolvedValue(run({
      package: { ...run().package, isPuppySchool: true },
    }))
    const res = await call('class')
    expect(res.status).toBe(409)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('is scoped to the caller’s business', async () => {
    h.runFindFirst.mockResolvedValue(null)
    const res = await call('event')
    expect(res.status).toBe(404)
    // The lookup must be filtered by trainerId, not just by run id.
    expect(h.runFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'run_1', trainerId: 't1' })
  })
})

describe('what each conversion actually writes', () => {
  it('class → event sets the flags explicitly, both of them', async () => {
    h.runFindFirst.mockResolvedValue(run())

    const res = await call('event')

    expect(res.status).toBe(200)
    // Both flags stated. A kind is declared, never left to be inferred.
    expect(h.pkgUpdate.mock.calls[0][0].data).toMatchObject({ isEvent: true, allowDropIn: false, isGroup: true })
  })

  it('class → casual turns on drop-ins and leaves a schedule behind', async () => {
    h.runFindFirst.mockResolvedValue(run())

    const res = await call('casual')

    expect(res.status).toBe(200)
    expect(h.pkgUpdate.mock.calls[0][0].data).toMatchObject({ allowDropIn: true, isEvent: false })
    // A casual class is scheduled by slot; without one it would have no
    // schedule at all.
    expect(h.slotCreate).toHaveBeenCalled()
  })

  it('leaving an event clears its ticket tiers', async () => {
    h.runFindFirst.mockResolvedValue(run({
      package: { ...run().package, isEvent: true },
    }))

    await call('class')

    // Tiers have no screen to be edited from once it is not an event.
    expect(h.tierDeleteMany).toHaveBeenCalledWith({ where: { packageId: 'pkg_1' } })
  })

  it('leaving a casual class clears its slots', async () => {
    h.runFindFirst.mockResolvedValue(run({
      package: { ...run().package, allowDropIn: true },
    }))

    await call('class')

    // Otherwise they keep generating sessions for a series that no longer
    // works that way.
    expect(h.slotDeleteMany).toHaveBeenCalledWith({ where: { packageId: 'pkg_1' } })
  })

  it('warns that a series price is now a per-drop-in price', async () => {
    h.runFindFirst.mockResolvedValue(run({
      sessions: [
        { id: 's1', scheduledAt: new Date('2026-08-06T19:00:00Z'), durationMins: 60 },
        { id: 's2', scheduledAt: new Date('2026-08-13T19:00:00Z'), durationMins: 60 },
      ],
    }))

    const body = await (await call('casual')).json()

    // Carried, never recalculated — but never silent either.
    expect(body.priceWarning).toBeTruthy()
  })
})
