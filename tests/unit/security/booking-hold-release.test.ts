import { describe, it, expect, vi, beforeEach } from 'vitest'

// DELETE /my/booking-hold/[holdId] — the undo of claiming a slot.
//
// The undo test the ratchet asks for: what did the create do, and does this
// undo all of it? Creating a hold does exactly ONE thing — it writes a
// BookingHold row. No session, no assignment, no invoice, no stock, no
// notification. So the undo has exactly one thing to do, and the test that
// matters is that the create really is that small (audit C-3 / T-3 were both an
// undo that undid one of the several things its action did).
//
// PATCH is here too, because it is the other half of the same route and it is
// where the answers that open the gate are stored.
const h = vi.hoisted(() => ({
  activeClient: vi.fn(),
  holdFindFirst: vi.fn(),
  holdFindMany: vi.fn(),
  holdCreate: vi.fn(),
  holdUpdate: vi.fn(),
  holdDelete: vi.fn(),
  holdDeleteMany: vi.fn(),
  stepFindFirst: vi.fn(),
  formFindUnique: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingHold: {
      findFirst: h.holdFindFirst,
      findMany: h.holdFindMany,
      create: h.holdCreate,
      update: h.holdUpdate,
      delete: h.holdDelete,
      deleteMany: h.holdDeleteMany,
    },
    commsFlowStep: { findFirst: h.stepFindFirst },
    form: { findUnique: h.formFindUnique },
  },
}))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.activeClient }))

import { DELETE, PATCH } from '@/app/api/my/booking-hold/[holdId]/route'
import { createBookingHold } from '@/lib/booking-holds'

const CLIENT = 'cl_1'
const HOLD = 'hold_1'
const FORM = 'form_1'
const params = Promise.resolve({ holdId: HOLD })

const patch = (body: unknown) =>
  PATCH(
    new Request('https://app.example.com/api/my/booking-hold/hold_1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params },
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.activeClient.mockResolvedValue({ clientId: CLIENT, isPreview: false })
  h.holdFindFirst.mockResolvedValue({ id: HOLD, clientId: CLIENT, trainerId: 'tr_1', packageId: 'pkg_1' })
  h.holdDeleteMany.mockResolvedValue({ count: 1 })
  h.holdUpdate.mockResolvedValue({})
  h.holdCreate.mockResolvedValue({ id: HOLD, expiresAt: new Date(), createdAt: new Date() })
  h.stepFindFirst.mockResolvedValue(null)
  h.formFindUnique.mockResolvedValue(null)
})

describe('creating a hold does exactly one thing', () => {
  // The whole basis of the undo below. If a hold ever starts writing a session,
  // an invoice or a notification, this fails and whoever added it has to make
  // the release undo that too.
  it('writes a BookingHold and nothing else', async () => {
    h.holdFindFirst.mockResolvedValue(null) // nobody else claimed the slot
    await createBookingHold({
      trainerId: 'tr_1', clientId: CLIENT, packageId: 'pkg_1',
      slotAt: new Date(), durationMins: 60,
    })
    expect(h.holdCreate).toHaveBeenCalledTimes(1)
    expect(h.holdUpdate).not.toHaveBeenCalled()
  })
})

describe('DELETE — giving the slot back', () => {
  it('deletes the hold, and that is the whole undo', async () => {
    const res = await DELETE(new Request('https://x/', { method: 'DELETE' }), { params })
    expect(res.status).toBe(200)
    expect(h.holdDeleteMany).toHaveBeenCalledTimes(1)
  })

  // Somebody else's claim is not theirs to cancel — that would be a way to take
  // a slot off another client by guessing an id.
  it('is scoped to the caller’s own hold', async () => {
    await DELETE(new Request('https://x/', { method: 'DELETE' }), { params })
    expect(h.holdDeleteMany).toHaveBeenCalledWith({ where: { id: HOLD, clientId: CLIENT } })
  })

  it('refuses a caller with no client session', async () => {
    h.activeClient.mockResolvedValue(null)
    const res = await DELETE(new Request('https://x/', { method: 'DELETE' }), { params })
    expect(res.status).toBe(401)
    expect(h.holdDeleteMany).not.toHaveBeenCalled()
  })

  // Called when somebody taps Back. A "no such hold" error on the way back to
  // the time picker helps nobody, and the row expires by itself regardless.
  it('is quiet and idempotent about a hold that has already gone', async () => {
    h.holdDeleteMany.mockResolvedValue({ count: 0 })
    expect((await DELETE(new Request('https://x/', { method: 'DELETE' }), { params })).status).toBe(200)
  })
})

describe('PATCH — storing the answers that open the gate', () => {
  function gateOn() {
    h.stepFindFirst.mockResolvedValue({ id: 'step_1', payload: { formId: FORM } })
    h.formFindUnique.mockResolvedValue({
      id: FORM, trainerId: 'tr_1', name: 'Pre-groom questions', description: null,
      questions: [{ id: 'q1', type: 'TEXT', label: 'Sore spots?', required: true }],
      steps: [], isActive: true,
    })
  }

  it('will not let anybody answer somebody else’s hold', async () => {
    h.holdFindFirst.mockResolvedValueOnce(null) // scoped query found nothing
    expect((await patch({ answers: { q1: 'no' } })).status).toBe(404)
    expect(h.holdUpdate).not.toHaveBeenCalled()
  })

  // The same server-side check the booking itself applies. Storing an
  // incomplete answer set and refusing later would be a gate that lets somebody
  // walk all the way to Confirm before saying no.
  it('refuses an incomplete answer set', async () => {
    gateOn()
    const res = await patch({ answers: {} })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FORM_REQUIRED', missing: ['q1'] })
    expect(h.holdUpdate).not.toHaveBeenCalled()
  })

  it('stores a complete one', async () => {
    gateOn()
    expect((await patch({ answers: { q1: 'no' } })).status).toBe(200)
    expect(h.holdUpdate.mock.calls[0][0].data.answers).toEqual({ q1: 'no' })
  })

  // The hold lapsed while they were typing. Told plainly, with a code the wizard
  // turns into "that time went, pick another" — not accepted and refused at the
  // end.
  it('says so plainly when the hold lapsed mid-answer', async () => {
    gateOn()
    h.holdFindFirst
      .mockResolvedValueOnce({ id: HOLD, clientId: CLIENT, trainerId: 'tr_1', packageId: 'pkg_1' })
      .mockResolvedValueOnce(null) // the live-hold read filtered it out
    const res = await patch({ answers: { q1: 'no' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'HOLD_EXPIRED' })
  })

  // A trainer can switch the gate off while somebody is mid-booking. That should
  // let them straight through, not strand them on a step with nothing on it.
  it('lets them through when the trainer took the gate down mid-booking', async () => {
    const res = await patch({ answers: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: false })
  })
})
