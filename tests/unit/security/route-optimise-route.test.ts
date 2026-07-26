import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/route/optimise now takes generic stops — a client OR a class /
// event / daycare run — because the planner covers the whole schedule. Both
// kinds are named by ID and looked up here, tenant-scoped, rather than trusted
// from the request body: a caller must not be able to route (and so read the
// venue and drive time of) another business's class.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  profileFindUnique: vi.fn(),
  clientFindMany: vi.fn(),
  runFindMany: vi.fn(),
  optimiseRoute: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.profileFindUnique },
    clientProfile: { findMany: h.clientFindMany },
    classRun: { findMany: h.runFindMany },
  },
}))
vi.mock('@/lib/routing', () => ({ optimiseRoute: h.optimiseRoute }))

import { POST } from '@/app/api/route/optimise/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/route/optimise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const BASE = { baseLat: -37.68, baseLng: 176.16, baseAddress: '1 Base Rd' }

beforeEach(() => {
  h.auth.mockReset(); h.profileFindUnique.mockReset()
  h.clientFindMany.mockReset(); h.runFindMany.mockReset(); h.optimiseRoute.mockReset()

  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: 'co_1' } })
  h.profileFindUnique.mockResolvedValue(BASE)
  h.clientFindMany.mockResolvedValue([])
  h.runFindMany.mockResolvedValue([])
  h.optimiseRoute.mockResolvedValue({
    order: [0],
    legs: [
      { durationSec: 600, distanceMeters: 5000, end: { lat: -37.7, lng: 176.2 } },
      { durationSec: 600, distanceMeters: 5000, end: { lat: -37.68, lng: 176.16 } },
    ],
    totalDurationSec: 1200,
    totalDistanceMeters: 10000,
    polyline: 'abc',
  })
})

describe('POST /api/route/optimise — tenancy', () => {
  it('rejects anyone who is not a trainer', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
    const res = await POST(req({ stops: [{ kind: 'client', id: 'c1' }] }))
    expect(res.status).toBe(401)
  })

  it('rejects a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ stops: [{ kind: 'group', id: 'r1' }] }))
    expect(res.status).toBe(401)
  })

  it('scopes both lookups to the calling business', async () => {
    h.clientFindMany.mockResolvedValue([{
      id: 'c1', addressLine: '2 Foo St', addressLat: -37.7, addressLng: 176.2,
      user: { name: 'Lucy', email: 'l@example.com' },
    }])
    await POST(req({ stops: [{ kind: 'client', id: 'c1' }, { kind: 'group', id: 'r1' }] }))

    expect(h.clientFindMany.mock.calls[0][0].where).toMatchObject({ trainerId: 'co_1' })
    expect(h.runFindMany.mock.calls[0][0].where).toMatchObject({ trainerId: 'co_1' })
  })

  it('drops a run that belongs to another business', async () => {
    // findMany returns nothing for a foreign id, so the stop never reaches
    // the Routes API and nothing about it comes back.
    const res = await POST(req({ stops: [{ kind: 'group', id: 'r_other' }] }))
    expect(res.status).toBe(400)
    expect(h.optimiseRoute).not.toHaveBeenCalled()
  })
})

describe('POST /api/route/optimise — stop kinds', () => {
  it('sends a class venue as an address waypoint and pins it from the leg', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'r1', name: 'Puppy Foundations', location: 'Memorial Park' }])

    const res = await POST(req({ stops: [{ kind: 'group', id: 'r1' }], optimize: false }))
    expect(res.status).toBe(200)

    // Free text, not coordinates — the venue has none anywhere in the schema.
    expect(h.optimiseRoute.mock.calls[0][2]).toEqual([{ address: 'Memorial Park' }])

    const body = await res.json()
    expect(body.stops[0]).toMatchObject({
      kind: 'group', classRunId: 'r1', clientId: null, address: 'Memorial Park',
      // Resolved by Google as part of the same call — this is the only way a
      // venue-only stop ever gets onto the map.
      lat: -37.7, lng: 176.2,
    })
  })

  it('sends a client as coordinates', async () => {
    h.clientFindMany.mockResolvedValue([{
      id: 'c1', addressLine: '2 Foo St', addressLat: -37.7, addressLng: 176.2,
      user: { name: 'Lucy', email: 'l@example.com' },
    }])

    const res = await POST(req({ stops: [{ kind: 'client', id: 'c1' }] }))
    expect(res.status).toBe(200)
    expect(h.optimiseRoute.mock.calls[0][2]).toEqual([{ lat: -37.7, lng: 176.2 }])
    expect((await res.json()).stops[0]).toMatchObject({ kind: 'client', clientId: 'c1', classRunId: null })
  })

  it('echoes the caller\'s stop key so the run-sheet can match it back', async () => {
    // A group stop's day key is "run:<id>:<venue>" — one run can be two
    // arrivals in a day — so the API cannot rebuild it from kind+id. Without
    // the echo the daycare row in the run-sheet lost its time window and its
    // link fell back to "#".
    h.runFindMany.mockResolvedValue([{ id: 'r1', name: 'Daycare', location: 'Russley Drive' }])
    const res = await POST(req({ stops: [{ kind: 'group', id: 'r1', stopId: 'run:r1:Russley Drive' }] }))
    expect((await res.json()).stops[0].stopId).toBe('run:r1:Russley Drive')
  })

  it('reports a run with no venue rather than routing it', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'r1', name: 'Unlocated Class', location: '   ' }])
    const res = await POST(req({ stops: [{ kind: 'group', id: 'r1' }] }))

    expect(res.status).toBe(400)
    expect((await res.json()).unlocated).toEqual([{ key: 'group:r1', name: 'Unlocated Class' }])
  })

  it('keeps the caller order when optimize is false', async () => {
    h.clientFindMany.mockResolvedValue([
      { id: 'c2', addressLine: 'b', addressLat: 1, addressLng: 1, user: { name: 'Second', email: 'b@x.com' } },
      { id: 'c1', addressLine: 'a', addressLat: 2, addressLng: 2, user: { name: 'First', email: 'a@x.com' } },
    ])
    h.optimiseRoute.mockResolvedValue({
      order: [0, 1],
      legs: [
        { durationSec: 1, distanceMeters: 1, end: null },
        { durationSec: 1, distanceMeters: 1, end: null },
        { durationSec: 1, distanceMeters: 1, end: null },
      ],
      totalDurationSec: 3, totalDistanceMeters: 3, polyline: null,
    })

    // findMany does not preserve the requested order; the route must.
    const res = await POST(req({ stops: [{ kind: 'client', id: 'c1' }, { kind: 'client', id: 'c2' }], optimize: false }))
    const body = await res.json()
    expect(body.stops.map((s: { name: string }) => s.name)).toEqual(['First', 'Second'])
  })
})

describe('POST /api/route/optimise — base of operations', () => {
  it('refuses to plan without one, and says so', async () => {
    h.profileFindUnique.mockResolvedValue({ baseLat: null, baseLng: null, baseAddress: null })
    const res = await POST(req({ stops: [{ kind: 'client', id: 'c1' }] }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.needsBase).toBe(true)
    expect(h.optimiseRoute).not.toHaveBeenCalled()
  })
})
