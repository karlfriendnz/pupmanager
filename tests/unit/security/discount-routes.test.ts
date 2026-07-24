import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant + permission guards for the discount routes: a trainer can only attach
// a discount to their own package, only edit/delete their own discounts, and a
// caller without classes.manage is refused before any write.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  pkgFindFirst: vi.fn(),
  discFindFirst: vi.fn(),
  discFindMany: vi.fn(),
  discCreate: vi.fn(),
  discUpdate: vi.fn(),
  discDelete: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst },
    discount: { findFirst: h.discFindFirst, findMany: h.discFindMany, create: h.discCreate, update: h.discUpdate, delete: h.discDelete },
  },
}))

import { POST as createDiscount } from '@/app/api/trainer/discounts/route'
import { PATCH as patchDiscount, DELETE as deleteDiscount } from '@/app/api/trainer/discounts/[id]/route'

function req(body: unknown = {}) {
  return new Request('https://app.pupmanager.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const idParams = { params: Promise.resolve({ id: 'disc1' }) }
const validCreate = { packageId: 'pkg-x', name: 'Whole day', modifierType: 'REPLACE', modifierValue: 5500, applyTo: 'order_total', conditions: [{ key: 'booked_full_day' }] }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
})

describe('discount route guards', () => {
  it('refuses a caller without classes.manage before any write', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await createDiscount(req(validCreate))
    expect(res.status).toBe(403)
    expect(h.discCreate).not.toHaveBeenCalled()
  })

  it('404s attaching a discount to a package another company owns', async () => {
    h.pkgFindFirst.mockResolvedValue(null) // not the trainer's package
    const res = await createDiscount(req(validCreate))
    expect(res.status).toBe(404)
    expect(h.discCreate).not.toHaveBeenCalled()
  })

  it('404s patching a discount the caller does not own', async () => {
    h.discFindFirst.mockResolvedValue(null)
    const res = await patchDiscount(req({ modifierValue: 100 }), idParams)
    expect(res.status).toBe(404)
    expect(h.discUpdate).not.toHaveBeenCalled()
  })

  it('404s deleting a discount the caller does not own', async () => {
    h.discFindFirst.mockResolvedValue(null)
    const res = await deleteDiscount(req(), idParams)
    expect(res.status).toBe(404)
    expect(h.discDelete).not.toHaveBeenCalled()
  })
})
