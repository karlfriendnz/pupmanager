import { describe, it, expect, vi, beforeEach } from 'vitest'

// Client self-booking is the 1:1 path: pick an hour out of the trainer's open
// diary and the package's sessions are cut from there. A GROUP offering — a
// class, a drop-in, an event — runs on its own fixed timetable and is joined
// from the classes list by picking real sessions.
//
// A group package with clientSelfBook on was reaching this route, which offered
// the trainer's free hours for something that runs Mondays at 1:34. Booking it
// would have cut private sessions off a shared timetable: sessions nobody else
// in the class holds, at an hour the class doesn't run, with the client never
// appearing on its roster.
const h = vi.hoisted(() => ({
  clientCtx: vi.fn(),
  profileFindUnique: vi.fn(),
  pkgFindMany: vi.fn(),
  pkgFindFirst: vi.fn(),
  enforceRateLimit: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.clientCtx }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findMany: h.pkgFindMany, findFirst: h.pkgFindFirst },
    clientProfile: { findUnique: h.profileFindUnique },
  },
}))

import { GET, POST } from '@/app/api/my/self-book/route'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/my/self-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  h.clientCtx.mockResolvedValue({ clientId: 'cl_1', isPreview: false })
  // The route resolves the trainer from the client's profile, not the session.
  h.profileFindUnique.mockResolvedValue({
    id: 'cl_1', trainerId: 'tr_me', dogId: null,
    user: { name: 'Sam' }, dog: null,
    trainer: { user: { id: 'u_tr' } }, assignedTrainer: null,
  })
  h.pkgFindMany.mockResolvedValue([])
  h.pkgFindFirst.mockResolvedValue(null)
  h.enforceRateLimit.mockResolvedValue(null)
})

describe('self-booking never offers a group offering', () => {
  it('lists 1:1 packages only', async () => {
    await GET()
    expect(h.pkgFindMany.mock.calls[0][0].where).toMatchObject({
      trainerId: 'tr_me', clientSelfBook: true, isGroup: false,
    })
  })

  // The filter has to be on the booking too, not just the list — hiding it in
  // the UI isn't a guard.
  it('refuses to book a group package even when asked for by id', async () => {
    const res = await post({ packageId: 'pkg_class', startDate: new Date(Date.now() + 86_400_000).toISOString() })
    expect(res.status).toBe(404)
    expect(h.pkgFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'pkg_class', trainerId: 'tr_me', clientSelfBook: true, isGroup: false,
    })
  })

  it('still scopes to the client’s own trainer', async () => {
    await post({ packageId: 'pkg_1', startDate: new Date(Date.now() + 86_400_000).toISOString() })
    expect(h.pkgFindFirst.mock.calls[0][0].where.trainerId).toBe('tr_me')
  })

  it('rejects a trainer previewing the client app', async () => {
    h.clientCtx.mockResolvedValue({ clientId: 'cl_1', isPreview: true })
    const res = await post({ packageId: 'pkg_1', startDate: new Date(Date.now() + 86_400_000).toISOString() })
    expect(res.status).toBe(403)
    expect(h.pkgFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a signed-out visitor', async () => {
    h.clientCtx.mockResolvedValue(null)
    expect((await post({ packageId: 'pkg_1', startDate: '2030-01-01T00:00:00Z' })).status).toBe(401)
  })
})
