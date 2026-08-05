import { describe, it, expect, vi, beforeEach } from 'vitest'

// A booking window the trainer sets must survive the save.
//
// AGENTS.md, bug #1: "a field the user typed must survive a reload, and the
// only proof is save → reload → assert". Three separate fields in this repo
// have returned 200 and stored nothing. This pins the whole loop for the
// booking window at the API boundary: what POST/PATCH write, read back out
// through the same resolver the client picker and the self-book route use.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  pkgFindFirst: vi.fn(),
  pkgFindUnique: vi.fn(),
  pkgUpdate: vi.fn(),
  pkgCreate: vi.fn(),
  pkgAggregate: vi.fn(),
  classRunCount: vi.fn(),
  classRunFindMany: vi.fn(),
  classRunCreate: vi.fn(),
  clientPackageCount: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  attendanceCount: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/class-session-sync', () => ({ syncClassSessions: vi.fn(), removeClassEvents: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    package: {
      findFirst: h.pkgFindFirst,
      findUnique: h.pkgFindUnique,
      update: h.pkgUpdate,
      create: h.pkgCreate,
      aggregate: h.pkgAggregate,
    },
    classRun: { count: h.classRunCount, findMany: h.classRunFindMany, create: h.classRunCreate },
    classRunTrainer: { deleteMany: vi.fn(), createMany: vi.fn() },
    trainerMembership: { findMany: vi.fn(() => []) },
    clientPackage: { count: h.clientPackageCount },
    trainingSession: {
      createMany: vi.fn(), findMany: h.sessionFindMany, updateMany: vi.fn(), deleteMany: h.sessionDeleteMany,
    },
    sessionAttendance: { count: h.attendanceCount },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
  }
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } }
})

import { POST } from '@/app/api/packages/route'
import { PATCH } from '@/app/api/packages/[packageId]/route'
import { packageBookingWindow } from '@/lib/package-booking-window'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/packages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/packages/pkg_1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ packageId: 'pkg_1' }) })

const NEW_ONE_TO_ONE = { name: 'Puppy Intro', sessionCount: 1, weeksBetween: 0, durationMins: 60 }

const created = () => h.pkgCreate.mock.calls[0][0].data
const updated = () => h.pkgUpdate.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
  h.pkgFindFirst.mockResolvedValue({
    id: 'pkg_1', trainerId: 'tr_me', isGroup: false, isPuppySchool: false, isEvent: false,
    name: 'Puppy Intro', sessionCount: 1, weeksBetween: 0, durationMins: 60, bufferMins: 0,
    sessionType: 'IN_PERSON' as const, priceCents: null, specialPriceCents: null,
    pricePerSessionCents: null, allowDropIn: false, sessionSlots: [],
    bookingWindowMode: 'ANY_TIME', bookingWindowRanges: [], bookingWindowDates: [],
    bookingWindowTimes: [], bookingWindowDays: [], bookingWindowStart: null, bookingWindowEnd: null,
  })
  h.pkgFindUnique.mockResolvedValue({ isGroup: false })
  h.pkgAggregate.mockResolvedValue({ _max: { order: 0 } })
  h.pkgCreate.mockImplementation(async ({ data }) => ({ id: 'pkg_new', ...data }))
  h.pkgUpdate.mockImplementation(async ({ data }) => ({ id: 'pkg_1', isGroup: false, ...data }))
  h.classRunCount.mockResolvedValue(0)
  h.classRunFindMany.mockResolvedValue([])
  h.clientPackageCount.mockResolvedValue(0)
  h.sessionFindMany.mockResolvedValue([])
  h.sessionDeleteMany.mockResolvedValue({ count: 0 })
  h.attendanceCount.mockResolvedValue(0)
  h.trainerProfileFindUnique.mockResolvedValue({ user: { timezone: 'Pacific/Auckland' } })
})

describe('creating a 1:1 offering', () => {
  it('defaults to ANY_TIME when the form says nothing about a window', () => {
    // Nothing changes for anyone who never opens this control.
    return post(NEW_ONE_TO_ONE).then(async res => {
      expect(res.status).toBe(201)
      expect(created().bookingWindowMode).toBe('ANY_TIME')
      expect(packageBookingWindow(created()).mode).toBe('ANY_TIME')
    })
  })

  it('stores per-day bands and reads them back identically', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'RESTRICTED',
        ranges: [{ day: 3, start: '13:00', end: '19:00' }, { day: 1, start: '15:00', end: '17:00' }],
      },
    })
    expect(res.status).toBe(201)
    // The columns…
    expect(created().bookingWindowMode).toBe('RESTRICTED')
    expect(created().bookingWindowRanges).toEqual([
      { day: 1, start: '15:00', end: '17:00' },
      { day: 3, start: '13:00', end: '19:00' },
    ])
    // …and what the reader sees when the form reopens on them.
    expect(packageBookingWindow(created())).toEqual({
      mode: 'RESTRICTED',
      ranges: [{ day: 1, start: '15:00', end: '17:00' }, { day: 3, start: '13:00', end: '19:00' }],
      dates: [],
    })
  })

  it('stores one-off dated starts and reads them back identically', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'RESTRICTED',
        dates: [{ date: '2030-01-12', time: '14:00' }, { date: '2030-01-08', time: '09:00' }],
      },
    })
    expect(res.status).toBe(201)
    expect(packageBookingWindow(created())).toEqual({
      mode: 'RESTRICTED',
      ranges: [],
      dates: [{ date: '2030-01-08', time: '09:00' }, { date: '2030-01-12', time: '14:00' }],
    })
  })

  it('stores BOTH halves at once — bands and a one-off together', async () => {
    // Karl's ask: "a combination of days in the week and set times also".
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'RESTRICTED',
        ranges: [{ day: 1, start: '15:00', end: '17:00' }],
        dates: [{ date: '2030-01-12', time: '10:00' }],
      },
    })
    expect(res.status).toBe(201)
    expect(packageBookingWindow(created())).toEqual({
      mode: 'RESTRICTED',
      ranges: [{ day: 1, start: '15:00', end: '17:00' }],
      dates: [{ date: '2030-01-12', time: '10:00' }],
    })
  })

  it('refuses a restricted window with nothing in it', async () => {
    // The form says this too. The form is not what makes it true.
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'RESTRICTED', ranges: [], dates: [] },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses a band that ends before it starts', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'RESTRICTED', ranges: [{ day: 2, start: '13:00', end: '09:00' }] },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses duplicated dated starts', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'RESTRICTED',
        dates: [{ date: '2030-01-08', time: '09:00' }, { date: '2030-01-08', time: '09:00' }],
      },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses a date that is not a real day', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'RESTRICTED', dates: [{ date: '2030-02-31', time: '09:00' }] },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })
})

describe('editing a 1:1 offering', () => {
  it('stores an edited window and reads it back identically', async () => {
    const res = await patch({
      bookingWindow: { mode: 'RESTRICTED', dates: [{ date: '2030-01-08', time: '10:30' }] },
    })
    expect(res.status).toBe(200)
    expect(packageBookingWindow(updated())).toEqual({
      mode: 'RESTRICTED', ranges: [], dates: [{ date: '2030-01-08', time: '10:30' }],
    })
  })

  it('going back to any-time CLEARS both halves', async () => {
    // Otherwise switching away and back would resurrect the old window.
    const res = await patch({
      bookingWindow: { mode: 'RESTRICTED', ranges: [{ day: 2, start: '09:00', end: '13:00' }] },
    })
    expect(res.status).toBe(200)
    expect(updated().bookingWindowDates).toEqual([])

    h.pkgUpdate.mockClear()
    const back = await patch({ bookingWindow: { mode: 'ANY_TIME' } })
    expect(back.status).toBe(200)
    expect(updated().bookingWindowMode).toBe('ANY_TIME')
    expect(updated().bookingWindowRanges).toEqual([])
    expect(updated().bookingWindowDates).toEqual([])
    // …and the legacy columns with them.
    expect(updated().bookingWindowTimes).toEqual([])
    expect(updated().bookingWindowDays).toEqual([])
    expect(updated().bookingWindowStart).toBeNull()
    expect(updated().bookingWindowEnd).toBeNull()
  })

  it('leaves the stored window ALONE when the patch doesn’t mention it', async () => {
    // A list screen that saves a row it never loaded the window for must not
    // quietly reopen a restricted offering — the visibleFrom rule, applied to
    // the same shape of problem.
    const res = await patch({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(updated()).not.toHaveProperty('bookingWindowMode')
    expect(updated()).not.toHaveProperty('bookingWindowRanges')
    expect(updated()).not.toHaveProperty('bookingWindowDates')
  })

  it('refuses an invalid window on edit too', async () => {
    const res = await patch({ bookingWindow: { mode: 'RESTRICTED', ranges: [], dates: [] } })
    expect(res.status).toBe(400)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })
})
