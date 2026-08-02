import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reordering a series curriculum. The thing under test is that a step and the
// homework that follows it move as ONE — they are joined only by the session
// number they share, so a renumber that lands them on different numbers is a
// silent data corruption nothing downstream can detect.
//
// Also covered: the unique index on (packageId, sessionIndex) cannot be
// violated mid-flight, the "after every session" homework bucket never moves,
// and another trainer's package writes nothing at all.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  pkgFindFirst: vi.fn(),
  planFindMany: vi.fn(),
  planUpdate: vi.fn(),
  hwUpdateMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst },
    packageSessionPlan: { findMany: h.planFindMany },
    $transaction: h.transaction,
  },
}))

import { POST as reorder } from '@/app/api/trainer/packages/[packageId]/session-plans/reorder/route'

const params = (packageId = 'p1') => ({ params: Promise.resolve({ packageId }) })
const body = (b: unknown) =>
  new Request('https://app.pupmanager.com/x', { method: 'POST', body: JSON.stringify(b) })

/** Every write the transaction made, in the order it made them. */
type Write =
  | { table: 'plan'; id: string; sessionIndex: number; order?: number }
  | { table: 'homework'; from: number; to: number }

let writes: Write[]

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guard.mockResolvedValue({ companyId: 'co1' })
  h.pkgFindFirst.mockResolvedValue({ id: 'p1' })
  // Sessions 1, 2 and 3 all have a plan written.
  h.planFindMany.mockResolvedValue([
    { id: 'plan-1', sessionIndex: 1 },
    { id: 'plan-2', sessionIndex: 2 },
    { id: 'plan-3', sessionIndex: 3 },
  ])

  writes = []
  h.planUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: { sessionIndex: number; order?: number } }) => {
    writes.push({ table: 'plan', id: where.id, sessionIndex: data.sessionIndex, order: data.order })
    return {}
  })
  h.hwUpdateMany.mockImplementation(async ({ where, data }: { where: { sessionIndex: number }; data: { sessionIndex: number } }) => {
    writes.push({ table: 'homework', from: where.sessionIndex, to: data.sessionIndex })
    return { count: 1 }
  })
  // Interactive form, so the test can watch the writes happen in order and
  // prove they all happened inside the one transaction.
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      packageSessionPlan: { update: h.planUpdate },
      packageDefaultTask: { updateMany: h.hwUpdateMany },
    }),
  )
})

describe('POST /api/trainer/packages/[packageId]/session-plans/reorder', () => {
  it('moves a plan and its homework together — session 3 to the front', async () => {
    const res = await reorder(body({ order: [3, 1, 2] }), params())
    expect(res.status).toBe(200)

    // Final resting place of each plan row, ignoring the parking pass.
    const finalPlan = new Map<string, number>()
    for (const w of writes) if (w.table === 'plan' && w.sessionIndex > 0) finalPlan.set(w.id, w.sessionIndex)
    expect(finalPlan.get('plan-3')).toBe(1)
    expect(finalPlan.get('plan-1')).toBe(2)
    expect(finalPlan.get('plan-2')).toBe(3)

    // …and homework lands on exactly the same numbers. Read as
    // old-number → final-number by following the parking value.
    const parked = new Map<number, number>() // negative slot → original session
    const finalHw = new Map<number, number>()
    for (const w of writes) {
      if (w.table !== 'homework') continue
      if (w.to < 0) parked.set(w.to, w.from)
      else finalHw.set(parked.get(w.from)!, w.to)
    }
    expect(finalHw.get(3)).toBe(1)
    expect(finalHw.get(1)).toBe(2)
    expect(finalHw.get(2)).toBe(3)

    // The point of the whole route, stated once: plan and homework agree.
    expect([...finalHw.entries()].sort()).toEqual([[1, 2], [2, 3], [3, 1]])
  })

  it('never writes a final session number while another row still holds it', async () => {
    await reorder(body({ order: [2, 1] }), params())

    // A straight swap is the case that breaks a naive UPDATE: writing plan-2 to
    // 1 while plan-1 is still on 1 violates @@unique([packageId, sessionIndex]).
    // Every moving row must be parked out of range FIRST.
    const planWrites = writes.filter((w): w is Extract<Write, { table: 'plan' }> => w.table === 'plan')
    const lastPark = planWrites.map(w => w.sessionIndex < 0).lastIndexOf(true)
    const firstFinal = planWrites.map(w => w.sessionIndex > 0).indexOf(true)
    expect(lastPark).toBeLessThan(firstFinal)
    // Parking slots are distinct, so they can't collide with each other either.
    const parks = planWrites.filter(w => w.sessionIndex < 0).map(w => w.sessionIndex)
    expect(new Set(parks).size).toBe(parks.length)

    // Homework is renumbered in two passes for the same reason: written in one
    // go, rows moved from 2 to 1 would be picked up again by "1 goes to 2".
    const hwWrites = writes.filter((w): w is Extract<Write, { table: 'homework' }> => w.table === 'homework')
    expect(hwWrites.filter(w => w.to < 0)).toHaveLength(2)
    expect(hwWrites.filter(w => w.to > 0)).toHaveLength(2)
    expect(hwWrites.map(w => w.to < 0).lastIndexOf(true)).toBeLessThan(hwWrites.map(w => w.to > 0).indexOf(true))
  })

  it('leaves the "after every session" homework bucket alone', async () => {
    await reorder(body({ order: [3, 1, 2] }), params())
    // sessionIndex null is that bucket. Nothing may target it, and no query may
    // match it — every homework where-clause is an equality on a real number.
    for (const w of writes) {
      if (w.table !== 'homework') continue
      expect(w.from).not.toBeNull()
      expect(w.to).not.toBeNull()
      expect(Number.isInteger(w.from)).toBe(true)
      expect(Number.isInteger(w.to)).toBe(true)
    }
  })

  it('keeps a gap in the numbering rather than squashing it to 1..N', async () => {
    // Session 8 is a step written past a shortened offering's end — the editor
    // keeps it visible on purpose. Dragging must not quietly promote it.
    h.planFindMany.mockResolvedValue([
      { id: 'plan-1', sessionIndex: 1 },
      { id: 'plan-8', sessionIndex: 8 },
    ])
    await reorder(body({ order: [8, 1] }), params())
    const finals = writes
      .filter((w): w is Extract<Write, { table: 'plan' }> => w.table === 'plan' && w.sessionIndex > 0)
      .map(w => w.sessionIndex)
      .sort((a, b) => a - b)
    expect(finals).toEqual([1, 8])
  })

  it('writes nothing for a package belonging to another trainer', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await reorder(body({ order: [3, 1, 2] }), params('p-theirs'))
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('scopes the package lookup to the caller\'s own company', async () => {
    await reorder(body({ order: [2, 1] }), params())
    expect(h.pkgFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', trainerId: 'co1' })
    // …and so does every read of the rows it is about to move.
    expect(h.planFindMany.mock.calls[0][0].where).toMatchObject({ packageId: 'p1' })
  })

  it('hands a permission refusal back without touching the data', async () => {
    const { NextResponse } = await import('next/server')
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await reorder(body({ order: [2, 1] }), params())
    expect(res.status).toBe(403)
    expect(h.pkgFindFirst).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('does the whole renumber in exactly ONE transaction', async () => {
    await reorder(body({ order: [3, 1, 2] }), params())
    expect(h.transaction).toHaveBeenCalledTimes(1)
    // Plans and homework both, so neither can land without the other.
    expect(writes.some(w => w.table === 'plan')).toBe(true)
    expect(writes.some(w => w.table === 'homework')).toBe(true)
  })

  it('rejects a duplicated session number', async () => {
    const res = await reorder(body({ order: [1, 1, 2] }), params())
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects a non-positive session number', async () => {
    const res = await reorder(body({ order: [0, 1] }), params())
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('does nothing at all when the order is unchanged', async () => {
    const res = await reorder(body({ order: [1, 2, 3] }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ moved: 0 })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('moves the homework of a session that has no plan written yet', async () => {
    // A blank session has no PackageSessionPlan row at all (the editor only
    // creates one when a title is typed), but it can still carry homework, and
    // that homework has to travel with the slot.
    h.planFindMany.mockResolvedValue([{ id: 'plan-1', sessionIndex: 1 }])
    await reorder(body({ order: [2, 1] }), params())
    const hwFinals = writes.filter((w): w is Extract<Write, { table: 'homework' }> => w.table === 'homework')
    expect(hwFinals.filter(w => w.to < 0).map(w => w.from).sort()).toEqual([1, 2])
  })
})
