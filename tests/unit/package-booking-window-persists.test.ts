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
    bookingWindowMode: 'ANY_TIME', bookingWindowDays: [], bookingWindowStart: null,
    bookingWindowEnd: null, bookingWindowTimes: [],
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

  it('stores a weekly window and reads it back identically', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'WEEKLY_WINDOW', days: [4, 2], startTime: '09:00', endTime: '13:00' },
    })
    expect(res.status).toBe(201)
    // The columns…
    expect(created().bookingWindowMode).toBe('WEEKLY_WINDOW')
    expect(created().bookingWindowDays).toEqual([2, 4])
    expect(created().bookingWindowStart).toBe('09:00')
    expect(created().bookingWindowEnd).toBe('13:00')
    // …and what the reader sees when the form reopens on them.
    expect(packageBookingWindow(created())).toEqual({
      mode: 'WEEKLY_WINDOW', days: [2, 4], startTime: '09:00', endTime: '13:00', times: [],
    })
  })

  it('stores named exact times and reads them back identically', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'EXACT_TIMES',
        times: [{ day: 4, time: '14:00' }, { day: 2, time: '09:00' }],
      },
    })
    expect(res.status).toBe(201)
    expect(packageBookingWindow(created())).toEqual({
      mode: 'EXACT_TIMES', days: [], startTime: null, endTime: null,
      times: [{ day: 2, time: '09:00' }, { day: 4, time: '14:00' }],
    })
  })

  it('refuses a window that names no days', async () => {
    // The form says this too. The form is not what makes it true.
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'WEEKLY_WINDOW', days: [], startTime: '09:00', endTime: '13:00' },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses a window that ends before it starts', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: { mode: 'WEEKLY_WINDOW', days: [2], startTime: '13:00', endTime: '09:00' },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses duplicated start times', async () => {
    const res = await post({
      ...NEW_ONE_TO_ONE,
      bookingWindow: {
        mode: 'EXACT_TIMES',
        times: [{ day: 2, time: '09:00' }, { day: 2, time: '09:00' }],
      },
    })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses exact-times with nothing named', async () => {
    const res = await post({ ...NEW_ONE_TO_ONE, bookingWindow: { mode: 'EXACT_TIMES', times: [] } })
    expect(res.status).toBe(400)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })
})

describe('editing a 1:1 offering', () => {
  it('stores an edited window and reads it back identically', async () => {
    const res = await patch({
      bookingWindow: { mode: 'EXACT_TIMES', times: [{ day: 2, time: '10:30' }] },
    })
    expect(res.status).toBe(200)
    expect(packageBookingWindow(updated())).toEqual({
      mode: 'EXACT_TIMES', days: [], startTime: null, endTime: null,
      times: [{ day: 2, time: '10:30' }],
    })
  })

  it('switching mode CLEARS the fields the old mode used', async () => {
    // Otherwise switching away and back would resurrect the old window.
    const res = await patch({
      bookingWindow: { mode: 'WEEKLY_WINDOW', days: [2], startTime: '09:00', endTime: '13:00' },
    })
    expect(res.status).toBe(200)
    expect(updated().bookingWindowTimes).toEqual([])

    h.pkgUpdate.mockClear()
    const back = await patch({ bookingWindow: { mode: 'ANY_TIME' } })
    expect(back.status).toBe(200)
    expect(updated().bookingWindowMode).toBe('ANY_TIME')
    expect(updated().bookingWindowDays).toEqual([])
    expect(updated().bookingWindowStart).toBeNull()
    expect(updated().bookingWindowEnd).toBeNull()
    expect(updated().bookingWindowTimes).toEqual([])
  })

  it('leaves the stored window ALONE when the patch doesn’t mention it', async () => {
    // A list screen that saves a row it never loaded the window for must not
    // quietly reopen a restricted offering — the visibleFrom rule, applied to
    // the same shape of problem.
    const res = await patch({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(updated()).not.toHaveProperty('bookingWindowMode')
    expect(updated()).not.toHaveProperty('bookingWindowTimes')
  })

  it('refuses an invalid window on edit too', async () => {
    const res = await patch({ bookingWindow: { mode: 'EXACT_TIMES', times: [] } })
    expect(res.status).toBe(400)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })
})
