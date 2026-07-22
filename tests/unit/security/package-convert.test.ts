import { describe, it, expect, vi, beforeEach } from 'vitest'

// Converting between 1:1 and group flips which half of the system owns a
// package: group packages are run as ClassRuns with a shared roster, 1:1 ones
// as per-client ClientPackage assignments. Flipping while either exists would
// strand them, so the conversion is refused rather than half-applied.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  pkgFindFirst: vi.fn(),
  pkgFindUnique: vi.fn(),
  pkgUpdate: vi.fn(),
  classRunCount: vi.fn(),
  clientPackageCount: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst, findUnique: h.pkgFindUnique, update: h.pkgUpdate },
    classRun: { count: h.classRunCount },
    clientPackage: { count: h.clientPackageCount },
  },
}))

import { PATCH } from '@/app/api/packages/[packageId]/route'

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/packages/pkg_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ packageId: 'pkg_1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
  h.pkgFindFirst.mockResolvedValue({ id: 'pkg_1' }) // ownPackage passes
  h.classRunCount.mockResolvedValue(0)
  h.clientPackageCount.mockResolvedValue(0)
  h.pkgUpdate.mockImplementation(async ({ data }) => ({ id: 'pkg_1', ...data }))
})

describe('PATCH /api/packages/[packageId] — converting 1:1 ↔ group', () => {
  it('converts 1:1 → group when nothing is assigned', async () => {
    h.pkgFindUnique.mockResolvedValue({ isGroup: false })
    const res = await patch({ isGroup: true })
    expect(res.status).toBe(200)
    expect(h.pkgUpdate.mock.calls[0][0].data.isGroup).toBe(true)
  })

  it('refuses 1:1 → group while clients are assigned', async () => {
    h.pkgFindUnique.mockResolvedValue({ isGroup: false })
    h.clientPackageCount.mockResolvedValue(3)
    const res = await patch({ isGroup: true })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/3 clients are assigned/i)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('refuses group → 1:1 while classes are running off it', async () => {
    h.pkgFindUnique.mockResolvedValue({ isGroup: true })
    h.classRunCount.mockResolvedValue(2)
    const res = await patch({ isGroup: false })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/running as 2 classes/i)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  // Capacity/waitlist/drop-in are meaningless on a 1:1 package, and a stale
  // capacity would silently cap a package that shouldn't have one.
  it('clears the group-only settings when converting back to 1:1', async () => {
    h.pkgFindUnique.mockResolvedValue({ isGroup: true })
    const res = await patch({ isGroup: false })
    expect(res.status).toBe(200)
    expect(h.pkgUpdate.mock.calls[0][0].data).toMatchObject({
      isGroup: false, capacity: null, allowDropIn: false,
      dropInPriceCents: null, allowWaitlist: false, publicEnrollment: false,
    })
  })

  // An ordinary edit must not pay for the conversion checks.
  it('skips the checks entirely when isGroup is not changing', async () => {
    h.pkgFindUnique.mockResolvedValue({ isGroup: true })
    await patch({ isGroup: true })
    expect(h.classRunCount).not.toHaveBeenCalled()
    expect(h.clientPackageCount).not.toHaveBeenCalled()
  })

  it('does not run them at all for an edit that omits isGroup', async () => {
    await patch({ name: 'Renamed' })
    expect(h.pkgFindUnique).not.toHaveBeenCalled()
    expect(h.pkgUpdate).toHaveBeenCalled()
  })

  it("404s on another trainer's package", async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    expect((await patch({ isGroup: true })).status).toBe(404)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })
})
