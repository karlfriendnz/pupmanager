import { describe, it, expect, vi, beforeEach } from 'vitest'

// Self-booking raises ONE receivable for the whole assignment. Cancelling the
// last session used to leave it standing, so a client who booked and changed
// their mind was billed for a package with no sessions in it — and the
// cancellation fee landed on top of that (audit T-12).
const h = vi.hoisted(() => ({
  sessionCount: vi.fn(),
  invoiceUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { count: h.sessionCount },
    invoice: { updateMany: h.invoiceUpdateMany },
  },
}))

import { settleAssignmentIfEmptied } from '@/lib/assignment-settle'

beforeEach(() => {
  vi.clearAllMocks()
  h.invoiceUpdateMany.mockResolvedValue({ count: 1 })
})

describe('a booking with no sessions left', () => {
  it('cancels the receivable it raised', async () => {
    h.sessionCount.mockResolvedValue(0)
    const out = await settleAssignmentIfEmptied('cp-1', 'trainer-1')
    expect(h.invoiceUpdateMany).toHaveBeenCalledWith({
      where: {
        trainerId: 'trainer-1',
        sourceType: 'PACKAGE',
        sourceId: 'cp-1',
        status: 'UNPAID',
      },
      data: { status: 'CANCELLED' },
    })
    expect(out.settled).toBe(true)
  })

  it('leaves the bill alone while ANY session remains', async () => {
    // The one that would quietly wipe money: six sessions bought, one cancelled,
    // and the other five still owed for.
    h.sessionCount.mockResolvedValue(5)
    const out = await settleAssignmentIfEmptied('cp-1', 'trainer-1')
    expect(h.invoiceUpdateMany).not.toHaveBeenCalled()
    expect(out.settled).toBe(false)
  })

  it('only ever touches an UNPAID invoice', async () => {
    h.sessionCount.mockResolvedValue(0)
    await settleAssignmentIfEmptied('cp-1', 'trainer-1')
    expect(h.invoiceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNPAID' }) }),
    )
  })

  it('does nothing for a session that belongs to no assignment', async () => {
    // A one-off session the trainer typed straight into the diary has no
    // clientPackageId and no receivable of this shape.
    const out = await settleAssignmentIfEmptied(null, 'trainer-1')
    expect(h.sessionCount).not.toHaveBeenCalled()
    expect(h.invoiceUpdateMany).not.toHaveBeenCalled()
    expect(out.settled).toBe(false)
  })

  it('reports honestly when there was no invoice to cancel', async () => {
    h.sessionCount.mockResolvedValue(0)
    h.invoiceUpdateMany.mockResolvedValue({ count: 0 })
    expect((await settleAssignmentIfEmptied('cp-1', 'trainer-1')).settled).toBe(false)
  })
})
