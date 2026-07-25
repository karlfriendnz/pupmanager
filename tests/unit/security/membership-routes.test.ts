import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant + permission guards for the membership routes: a trainer can only edit
// their own memberships and can only bundle offerings they own; a caller without
// packages.manage is refused before any write.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  memFindFirst: vi.fn(),
  memCreate: vi.fn(),
  memUpdate: vi.fn(),
  memDelete: vi.fn(),
  memFindFirstOrder: vi.fn(),
  itemCreateMany: vi.fn(),
  itemDeleteMany: vi.fn(),
  pkgCount: vi.fn(),
  runCount: vi.fn(),
  prodCount: vi.fn(),
  txn: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
// Memberships are add-on gated now; these tests are about the tenant guards,
// so the add-on is simply on.
vi.mock('@/lib/billing', () => ({ hasAddon: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    membership: { findFirst: h.memFindFirstOrder, create: h.memCreate, update: h.memUpdate },
    membershipItem: { createMany: h.itemCreateMany, deleteMany: h.itemDeleteMany },
    package: { count: h.pkgCount }, classRun: { count: h.runCount }, product: { count: h.prodCount },
  }
  return {
    prisma: {
      membership: { findFirst: h.memFindFirst, delete: h.memDelete },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})

import { POST as createMembership } from '@/app/api/trainer/memberships/route'
import { PATCH as patchMembership, DELETE as deleteMembership } from '@/app/api/trainer/memberships/[id]/route'

function req(body: unknown = {}) {
  return new Request('https://app.pupmanager.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const idParams = { params: Promise.resolve({ id: 'm1' }) }
const validBody = { name: 'Puppy Starter', priceCents: 24900, items: [{ kind: 'PACKAGE', packageId: 'pkg-x', quantity: 1 }] }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
  h.memFindFirstOrder.mockResolvedValue(null)
  h.memCreate.mockResolvedValue({ id: 'm1' })
})

describe('membership route guards', () => {
  it('refuses a caller without packages.manage before any write', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await createMembership(req(validBody))
    expect(res.status).toBe(403)
    expect(h.memCreate).not.toHaveBeenCalled()
  })

  it('404s creating a membership that bundles an offering the trainer does not own', async () => {
    h.pkgCount.mockResolvedValue(0) // the referenced package isn't theirs
    const res = await createMembership(req(validBody))
    expect(res.status).toBe(404)
    expect(h.memCreate).not.toHaveBeenCalled()
  })

  it('creates when every included offering is owned', async () => {
    h.pkgCount.mockResolvedValue(1)
    const res = await createMembership(req(validBody))
    expect(res.status).toBe(201)
    expect(h.memCreate).toHaveBeenCalledTimes(1)
    expect(h.itemCreateMany).toHaveBeenCalledTimes(1)
  })

  it("404s patching a membership the caller doesn't own", async () => {
    h.memFindFirst.mockResolvedValue(null)
    const res = await patchMembership(req({ name: 'x' }), idParams)
    expect(res.status).toBe(404)
    expect(h.memUpdate).not.toHaveBeenCalled()
  })

  it("404s deleting a membership the caller doesn't own", async () => {
    h.memFindFirst.mockResolvedValue(null)
    const res = await deleteMembership(req(), idParams)
    expect(res.status).toBe(404)
    expect(h.memDelete).not.toHaveBeenCalled()
  })
})
