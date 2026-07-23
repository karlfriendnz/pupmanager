import { describe, it, expect, vi, beforeEach } from 'vitest'

// A client self-adds to their trainer's waitlist when self-booking finds no
// slot that fits. The package it's filed against must belong to that trainer,
// and must actually keep a waitlist — the trainer opted in per package, so a
// package with the toggle off shouldn't collect entries even if the client
// posts straight at the route.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  pkgFindFirst: vi.fn(),
  entryFindFirst: vi.fn(),
  entryAggregate: vi.fn(),
  entryCreate: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    package: { findFirst: h.pkgFindFirst },
    waitlistEntry: {
      findFirst: h.entryFindFirst,
      aggregate: h.entryAggregate,
      create: h.entryCreate,
    },
  },
}))

import { POST } from '@/app/api/my/waitlist/route'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/my/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cl_1', isPreview: false })
  h.clientFindUnique.mockResolvedValue({
    id: 'cl_1', trainerId: 'tr_me', user: { name: 'Sam', email: 'sam@example.com' },
  })
  h.pkgFindFirst.mockResolvedValue({ id: 'pkg_1', allowWaitlist: true })
  h.entryFindFirst.mockResolvedValue(null)
  h.entryAggregate.mockResolvedValue({ _max: { priority: 2 } })
  h.entryCreate.mockResolvedValue({ id: 'w_1' })
})

describe('POST /api/my/waitlist', () => {
  it('adds the client to the waitlist for a package that keeps one', async () => {
    const res = await post({ packageId: 'pkg_1' })
    expect(res.status).toBe(201)
    expect(h.entryCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: 'tr_me', clientId: 'cl_1', packageId: 'pkg_1', priority: 3,
    })
  })

  it('refuses when the package has its waitlist turned off', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'pkg_1', allowWaitlist: false })
    const res = await post({ packageId: 'pkg_1' })
    expect(res.status).toBe(403)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  // The general "nothing is open for self-booking at all" waitlist isn't tied
  // to a package, so it stays available regardless of any package's toggle.
  it('still accepts a general entry with no package', async () => {
    const res = await post({})
    expect(res.status).toBe(201)
    expect(h.pkgFindFirst).not.toHaveBeenCalled()
    expect(h.entryCreate.mock.calls[0][0].data.packageId).toBeNull()
  })

  it("won't file an entry against another trainer's package", async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await post({ packageId: 'pkg_other' })
    expect(res.status).toBe(404)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('does not stack a second active entry for the same client', async () => {
    h.entryFindFirst.mockResolvedValue({ id: 'w_existing' })
    const res = await post({ packageId: 'pkg_1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyWaiting: true })
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('rejects a signed-out visitor', async () => {
    h.getActiveClient.mockResolvedValue(null)
    const res = await post({ packageId: 'pkg_1' })
    expect(res.status).toBe(401)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('rejects a preview session', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'cl_1', isPreview: true })
    const res = await post({ packageId: 'pkg_1' })
    expect(res.status).toBe(403)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })
})
