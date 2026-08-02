import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on default homework. Two surfaces:
//   • the offering editor (packages.manage, own package only)
//   • the one-tap confirm on a session (own session, own roster only)

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  auth: vi.fn(),
  pkgFindFirst: vi.fn(),
  libFindFirst: vi.fn(),
  defFindMany: vi.fn(),
  defFindFirst: vi.fn(),
  defCreate: vi.fn(),
  defUpdate: vi.fn(),
  defDelete: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  enrollFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  createManyAndReturn: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst },
    libraryTask: { findFirst: h.libFindFirst },
    packageDefaultTask: { findMany: h.defFindMany, findFirst: h.defFindFirst, create: h.defCreate, update: h.defUpdate, delete: h.defDelete },
    trainingSession: { findFirst: h.sessionFindFirst, findUnique: h.sessionFindUnique, findMany: h.sessionFindMany },
    classEnrollment: { findMany: h.enrollFindMany },
    trainingTask: { findMany: h.taskFindMany, createManyAndReturn: h.createManyAndReturn },
  },
}))

import { GET as listDefaults, POST as addDefault } from '@/app/api/trainer/packages/[packageId]/default-homework/route'
import { PATCH as patchDefault, DELETE as removeDefault } from '@/app/api/trainer/packages/[packageId]/default-homework/[rowId]/route'
import { GET as suggest, POST as confirm } from '@/app/api/sessions/[sessionId]/default-homework/route'

const ok = { companyId: 'co1' }
const body = (b: unknown) => new Request('https://app.pupmanager.com/x', { method: 'POST', body: JSON.stringify(b) })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guard.mockResolvedValue(ok)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 'co1' } })
  h.createManyAndReturn.mockImplementation(async ({ data }: { data: unknown[] }) => data)
  h.taskFindMany.mockResolvedValue([])
})

describe('offering editor — /api/trainer/packages/[packageId]/default-homework', () => {
  it('404s on another trainer\'s package instead of listing it', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await listDefaults(new Request('https://x'), { params: Promise.resolve({ packageId: 'p-theirs' }) })
    expect(res.status).toBe(404)
    expect(h.defFindMany).not.toHaveBeenCalled()
  })

  it('scopes the package lookup to the caller\'s company', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'p1', sessionCount: 6 })
    h.defFindMany.mockResolvedValue([])
    await listDefaults(new Request('https://x'), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(h.pkgFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', trainerId: 'co1' })
  })

  it('refuses a library item belonging to someone else', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'p1', sessionCount: 6 })
    h.libFindFirst.mockResolvedValue(null)
    const res = await addDefault(body({ sessionIndex: 1, libraryTaskId: 'L-theirs' }), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(res.status).toBe(404)
    expect(h.defCreate).not.toHaveBeenCalled()
  })

  it('refuses a default with no library item and no title', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'p1', sessionCount: 6 })
    const res = await addDefault(body({ sessionIndex: 1 }), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(res.status).toBe(400)
    expect(h.defCreate).not.toHaveBeenCalled()
  })

  it('hands a permission refusal straight back without touching the data', async () => {
    const { NextResponse } = await import('next/server')
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await listDefaults(new Request('https://x'), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(res.status).toBe(403)
    expect(h.pkgFindFirst).not.toHaveBeenCalled()
  })

  it('defaults a new row to practice, not preparation', async () => {
    // Silently flipping an offering's homework to "before" would put the whole
    // week's write-up in front of the client early, so the timing has to be
    // asked for explicitly.
    h.pkgFindFirst.mockResolvedValue({ id: 'p1', sessionCount: 6 })
    h.defFindFirst.mockResolvedValue(null)
    h.defCreate.mockResolvedValue({ id: 'd1' })
    await addDefault(body({ sessionIndex: 1, title: 'Crate rest' }), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(h.defCreate.mock.calls[0][0].data).toMatchObject({ timing: 'AFTER_SESSION' })
  })

  it('refuses a timing that is not one of the two', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'p1', sessionCount: 6 })
    const res = await addDefault(body({ sessionIndex: 1, title: 'Crate rest', timing: 'WHENEVER' }), { params: Promise.resolve({ packageId: 'p1' }) })
    expect(res.status).toBe(400)
    expect(h.defCreate).not.toHaveBeenCalled()
  })

  it('404s changing the timing of a row on someone else\'s package', async () => {
    h.defFindFirst.mockResolvedValue(null)
    const res = await patchDefault(
      new Request('https://x', { method: 'PATCH', body: JSON.stringify({ timing: 'BEFORE_SESSION' }) }),
      { params: Promise.resolve({ packageId: 'p1', rowId: 'd-theirs' }) },
    )
    expect(res.status).toBe(404)
    expect(h.defUpdate).not.toHaveBeenCalled()
  })

  it('lets timing be set on a LIBRARY-backed row, unlike its text', async () => {
    // The same library item is preparation on one offering and practice on
    // another, so timing belongs to this row — while the text still belongs to
    // the library and stays ignored here.
    h.defFindFirst.mockResolvedValue({ id: 'd1', libraryTaskId: 'L1' })
    h.defUpdate.mockResolvedValue({ id: 'd1' })
    await patchDefault(
      new Request('https://x', { method: 'PATCH', body: JSON.stringify({ timing: 'BEFORE_SESSION', title: 'Hijack the library' }) }),
      { params: Promise.resolve({ packageId: 'p1', rowId: 'd1' }) },
    )
    expect(h.defUpdate.mock.calls[0][0].data).toEqual({ timing: 'BEFORE_SESSION' })
  })

  it('404s deleting a row that is not on the caller\'s own package', async () => {
    h.defFindFirst.mockResolvedValue(null)
    const res = await removeDefault(new Request('https://x'), { params: Promise.resolve({ packageId: 'p1', rowId: 'd-theirs' }) })
    expect(res.status).toBe(404)
    expect(h.defDelete).not.toHaveBeenCalled()
  })
})

describe('session confirm — /api/sessions/[sessionId]/default-homework', () => {
  const groupSession = {
    id: 's1', clientId: null, sessionIndex: 2, clientPackageId: null, classRunId: 'r1',
    scheduledAt: new Date('2026-08-01T09:00:00.000Z'),
    classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Puppy Class' } },
    clientPackage: null,
  }

  it('rejects a client account outright', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'u2' } })
    const res = await suggest(new Request('https://x'), { params: Promise.resolve({ sessionId: 's1' }) })
    expect(res.status).toBe(401)
    expect(h.sessionFindFirst).not.toHaveBeenCalled()
  })

  it('scopes the session lookup to the caller\'s company', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await suggest(new Request('https://x'), { params: Promise.resolve({ sessionId: 's-theirs' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ packageId: null, tasks: [] })
    expect(h.sessionFindFirst.mock.calls[0][0].where).toMatchObject({ id: 's-theirs', trainerId: 'co1' })
  })

  it('404s confirming against another trainer\'s session', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await confirm(body({}), { params: Promise.resolve({ sessionId: 's-theirs' }) })
    expect(res.status).toBe(404)
    expect(h.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('ignores clientIds that are not on the session roster', async () => {
    h.sessionFindFirst.mockResolvedValue(groupSession)
    h.defFindMany.mockResolvedValue([
      { id: 'd1', order: 0, title: null, description: null, repetitions: null, videoUrl: null, libraryTask: { id: 'L1', title: 'Loose lead', description: null, repetitions: null, videoUrl: null } },
    ])
    h.enrollFindMany.mockResolvedValue([
      { id: 'e1', client: { id: 'c1', user: { name: 'Ana' } }, dog: { id: 'dog1', name: 'Bo', deceasedAt: null }, attendance: [] },
    ])

    const res = await confirm(body({ clientIds: ['c1', 'c-outsider'] }), { params: Promise.resolve({ sessionId: 's1' }) })

    expect(res.status).toBe(201)
    const written = h.createManyAndReturn.mock.calls[0][0].data as { clientId: string }[]
    expect(written.map(r => r.clientId)).toEqual(['c1'])
  })

  it('only hands out the offering\'s own defaults, whatever rowIds are asked for', async () => {
    h.sessionFindFirst.mockResolvedValue(groupSession)
    h.defFindMany.mockResolvedValue([
      { id: 'd1', order: 0, title: 'Mine', description: null, repetitions: null, videoUrl: null, libraryTask: null },
    ])
    h.enrollFindMany.mockResolvedValue([
      { id: 'e1', client: { id: 'c1', user: { name: 'Ana' } }, dog: null, attendance: [] },
    ])

    const res = await confirm(body({ rowIds: ['d-someone-elses'] }), { params: Promise.resolve({ sessionId: 's1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ created: 0 })
    expect(h.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('leaves a withdrawn enrolment and a deceased dog off the roster', async () => {
    h.sessionFindFirst.mockResolvedValue(groupSession)
    h.defFindMany.mockResolvedValue([])
    h.enrollFindMany.mockResolvedValue([
      { id: 'e1', client: { id: 'c1', user: { name: 'Ana' } }, dog: { id: 'd1', name: 'Bo', deceasedAt: new Date() }, attendance: [] },
      { id: 'e2', client: { id: 'c2', user: { name: 'Sam' } }, dog: { id: 'd2', name: 'Rex', deceasedAt: null }, attendance: [] },
    ])

    const res = await suggest(new Request('https://x'), { params: Promise.resolve({ sessionId: 's1' }) })
    const payload = await res.json()

    expect(payload.recipients.map((r: { clientId: string }) => r.clientId)).toEqual(['c2'])
    // Withdrawn seats never even come back from the database.
    expect(h.enrollFindMany.mock.calls[0][0].where.status).toBe('ENROLLED')
  })
})
