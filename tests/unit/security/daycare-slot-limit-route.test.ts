import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// The day-part limit, set from the daycare board. The tenant boundary is the
// findFirst scope — a slot from another trainer's daycare, or from a package
// that isn't a daycare at all, must be a 404 with nothing written.

const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  slotFindFirst: vi.fn(),
  slotUpdate: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: { packageSessionSlot: { findFirst: h.slotFindFirst, update: h.slotUpdate } },
}))

import { PATCH } from '@/app/api/trainer/daycare/slots/[slotId]/route'

function req(body: unknown): Request {
  return new Request('https://app.pupmanager.com/api/trainer/daycare/slots/slot1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (slotId = 'slot1') => Promise.resolve({ slotId })

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 't1' })
  h.slotFindFirst.mockResolvedValue({ id: 'slot1' })
  h.slotUpdate.mockResolvedValue({ id: 'slot1', capacity: 6 })
})

describe('PATCH /api/trainer/daycare/slots/[slotId]', () => {
  it('sets the limit on the trainer’s own day-part', async () => {
    const res = await PATCH(req({ capacity: 6 }), { params: params() })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, slot: { capacity: 6 } })
    expect(h.slotUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { capacity: 6 } }))
  })

  it('scopes the lookup to this company’s daycare only', async () => {
    await PATCH(req({ capacity: 6 }), { params: params() })
    expect(h.slotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot1', package: { trainerId: 't1', isPuppySchool: true } },
      }),
    )
  })

  it('404s another trainer’s slot without writing', async () => {
    h.slotFindFirst.mockResolvedValue(null)
    const res = await PATCH(req({ capacity: 6 }), { params: params('someone-elses') })
    expect(res.status).toBe(404)
    expect(h.slotUpdate).not.toHaveBeenCalled()
  })

  it('stops at the permission guard', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await PATCH(req({ capacity: 6 }), { params: params() })
    expect(res.status).toBe(403)
    expect(h.slotFindFirst).not.toHaveBeenCalled()
    expect(h.slotUpdate).not.toHaveBeenCalled()
  })

  // null is "no limit" — a real choice, not a missing field.
  it('clears the limit when given null', async () => {
    h.slotUpdate.mockResolvedValue({ id: 'slot1', capacity: null })
    const res = await PATCH(req({ capacity: null }), { params: params() })
    expect(res.status).toBe(200)
    expect(h.slotUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { capacity: null } }))
  })

  // 0 means "closed to new bookings today", which a short-staffed daycare wants.
  it('accepts a limit of zero', async () => {
    h.slotUpdate.mockResolvedValue({ id: 'slot1', capacity: 0 })
    const res = await PATCH(req({ capacity: 0 }), { params: params() })
    expect(res.status).toBe(200)
    expect(h.slotUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { capacity: 0 } }))
  })

  it.each([
    ['a negative limit', { capacity: -1 }],
    ['a fraction', { capacity: 2.5 }],
    ['a string', { capacity: '6' }],
    ['a missing field', {}],
  ])('400s on %s without writing', async (_label, body) => {
    const res = await PATCH(req(body), { params: params() })
    expect(res.status).toBe(400)
    expect(h.slotUpdate).not.toHaveBeenCalled()
  })
})
