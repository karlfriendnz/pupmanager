import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// A drop-in class IS its schedule. This spec walks the whole chain against the
// real embedded Postgres, because every link in it is a DB write:
//
//   trainer saves slots  →  they persist (day/time/price/capacity/venue/staff)
//   run is scheduled     →  sessions are generated FROM the slots, in date order
//   client books one     →  charged THAT session's price, capped by THAT slot
//
// The bug it exists to prevent: the slot editor used to be local state the save
// never sent, so a trainer could fill in a whole schedule and persist nothing —
// silently, with a success toast. Anything that stops slots reaching the DB, or
// stops their price/capacity reaching the session, fails here.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

/** The next YYYY-MM-DD that lands on `day` (0=Sun…6=Sat), at least a week out —
 *  so every generated session is comfortably in the future and bookable. */
function nextWeekday(day: number): string {
  const d = new Date(Date.now() + 7 * 864e5)
  while (d.getDay() !== day) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

test.describe('drop-in schedule slots', () => {
  test('slots persist, generate the sessions, and price each booking', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      const trainer = await prisma.trainerProfile.findFirst({ where: { userId: owner!.id }, select: { id: true } })
      const trainerId = trainer!.id

      await login(page, SEED.owner.email, SEED.owner.password)

      // A venue the trainer owns, to prove a slot keeps its location.
      const venue = await prisma.location.create({
        data: { trainerId, name: 'The Park', address: '1 Park Rd' },
      })
      cleanup.push(() => prisma.location.delete({ where: { id: venue.id } }).catch(() => {}))

      const tuesday = nextWeekday(2)
      const saturday = nextWeekday(6)

      // ── Save a drop-in offering with two DIFFERENT slots ──────────────────
      // Tuesdays $25 (cap 8) at the park, Saturdays $40 (cap 2) — the whole
      // point of the model is that these don't have to match.
      const createRes = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Drop-in Schedule',
          sessionCount: 1,
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          sessionSlots: [
            {
              startDate: tuesday, day: 2, startTime: '15:00', endTime: '17:00',
              capacity: 8, priceCents: 2500, locationId: venue.id,
              recurrenceRule: 'FREQ=WEEKLY;COUNT=2', requirePayment: false,
            },
            {
              startDate: saturday, day: 6, startTime: '09:00', endTime: '10:00',
              capacity: 2, priceCents: 4000,
              recurrenceRule: 'FREQ=WEEKLY;COUNT=2', requirePayment: false,
            },
          ],
        },
      })
      expect(createRes.status(), await createRes.text()).toBe(201)
      const pkgId = (await createRes.json()).id as string
      cleanup.push(() => prisma.package.delete({ where: { id: pkgId } }).catch(() => {}))

      // The schedule is really in the database — not just in the browser.
      const pkg = await prisma.package.findUnique({
        where: { id: pkgId },
        include: { sessionSlots: { orderBy: { order: 'asc' } } },
      })
      expect(pkg!.sessionSlots).toHaveLength(2)
      expect(pkg!.sessionSlots[0]).toMatchObject({
        day: 2, startTime: '15:00', endTime: '17:00', capacity: 8, priceCents: 2500, locationId: venue.id,
      })
      expect(pkg!.sessionSlots[1]).toMatchObject({ day: 6, startTime: '09:00', capacity: 2, priceCents: 4000 })

      // Having a schedule makes it a drop-in class, quoted from its CHEAPEST
      // slot — the server derives both, so the form can't get them wrong.
      expect(pkg!.allowDropIn).toBe(true)
      expect(pkg!.dropInPriceCents).toBe(2500)

      // ── Scheduling a run generates the sessions from those slots ──────────
      const runRes = await page.request.post('/api/class-runs', {
        data: { name: 'E2E Drop-in Run', startDate: `${tuesday}T00:00:00.000Z`, packageId: pkgId },
      })
      expect(runRes.status(), await runRes.text()).toBe(201)
      const runId = (await runRes.json()).id as string
      cleanup.push(() => prisma.classRun.delete({ where: { id: runId } }).catch(() => {}))

      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId: runId },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, durationMins: true, location: true, packageSessionSlotId: true, sessionIndex: true },
      })
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: runId } }).catch(() => {}))

      // 2 slots × 2 occurrences, interleaved into ONE chronological series.
      expect(sessions).toHaveLength(4)
      expect(sessions.map(s => s.sessionIndex)).toEqual([1, 2, 3, 4])
      const times = sessions.map(s => s.scheduledAt.getTime())
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      // Every session knows which slot priced it.
      expect(sessions.every(s => s.packageSessionSlotId)).toBe(true)

      const tuesdaySlotId = pkg!.sessionSlots[0].id
      const saturdaySlotId = pkg!.sessionSlots[1].id
      const tuesdaySessions = sessions.filter(s => s.packageSessionSlotId === tuesdaySlotId)
      const saturdaySessions = sessions.filter(s => s.packageSessionSlotId === saturdaySlotId)
      expect(tuesdaySessions).toHaveLength(2)
      expect(saturdaySessions).toHaveLength(2)
      // Each slot's own duration and venue rode along.
      expect(tuesdaySessions.every(s => s.durationMins === 120)).toBe(true)
      expect(saturdaySessions.every(s => s.durationMins === 60)).toBe(true)
      expect(tuesdaySessions.every(s => s.location === '1 Park Rd')).toBe(true)
      expect(saturdaySessions.every(s => s.location === null)).toBe(true)

      // ── Booking one is charged at THAT session's price ────────────────────
      // The Saturday slot is $40, not the $25 headline — this is the assertion
      // that per-session pricing reaches the money, not just the screen.
      const enrolRes = await page.request.post(`/api/class-runs/${runId}/enrollments`, {
        data: { clientId: SEED.assignedClientId, type: 'DROP_IN', sessionId: saturdaySessions[0].id, notify: false, sendInvoice: false },
      })
      expect(enrolRes.status(), await enrolRes.text()).toBe(201)

      const enr = await prisma.classEnrollment.findFirst({
        where: { classRunId: runId, clientId: SEED.assignedClientId },
        select: { id: true, type: true, dropInSessionId: true },
      })
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: runId } }).catch(() => {}))
      expect(enr?.type).toBe('DROP_IN')
      expect(enr?.dropInSessionId).toBe(saturdaySessions[0].id)

      const inv = await prisma.invoice.findFirst({
        where: { trainerId, sourceType: 'CLASS_ENROLLMENT', sourceId: enr!.id },
        select: { id: true, amountCents: true },
      })
      cleanup.push(() => (inv ? prisma.invoice.delete({ where: { id: inv.id } }).catch(() => {}) : Promise.resolve()))
      expect(inv?.amountCents).toBe(4000)

      // ── Editing the schedule keeps slot ids, so sessions keep their price ──
      const patchRes = await page.request.patch(`/api/packages/${pkgId}`, {
        data: {
          sessionSlots: [
            { id: tuesdaySlotId, startDate: tuesday, day: 2, startTime: '15:00', endTime: '17:00', capacity: 8, priceCents: 3000, locationId: venue.id, recurrenceRule: 'FREQ=WEEKLY;COUNT=2' },
            { id: saturdaySlotId, startDate: saturday, day: 6, startTime: '09:00', endTime: '10:00', capacity: 2, priceCents: 4000, recurrenceRule: 'FREQ=WEEKLY;COUNT=2' },
          ],
        },
      })
      expect(patchRes.status(), await patchRes.text()).toBe(200)

      const stillLinked = await prisma.trainingSession.count({
        where: { classRunId: runId, packageSessionSlotId: { not: null } },
      })
      expect(stillLinked, 'sessions must keep pointing at their slot after an edit').toBe(4)
      // The headline price follows the schedule down as well as up.
      expect((await prisma.package.findUnique({ where: { id: pkgId } }))!.dropInPriceCents).toBe(3000)

      // ── Taking Saturdays OFF the timetable takes the empty Saturdays with it ──
      // Dropping a slot used to delete only the row. The FK is SetNull, so every
      // session it had generated stayed in the diary — dates the trainer had
      // just removed, still on the board, still bookable, and now priced off the
      // package's headline rate because their own slot was gone. Nothing could
      // tidy them either: the nightly top-up keys on a non-null slot id, so an
      // orphan is invisible to it forever. Removing Saturdays left Saturdays
      // selling. So the future ones go — with one exception, below.
      const dropRes = await page.request.patch(`/api/packages/${pkgId}`, {
        data: {
          sessionSlots: [
            { id: tuesdaySlotId, startDate: tuesday, day: 2, startTime: '15:00', endTime: '17:00', capacity: 8, priceCents: 3000, locationId: venue.id, recurrenceRule: 'FREQ=WEEKLY;COUNT=2' },
          ],
        },
      })
      expect(dropRes.status()).toBe(200)
      expect(await prisma.packageSessionSlot.count({ where: { packageId: pkgId } })).toBe(1)

      const afterDrop = await prisma.trainingSession.findMany({
        where: { classRunId: runId },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, packageSessionSlotId: true },
      })
      // Both Tuesdays, untouched and still pointing at their slot — removing one
      // day-part says nothing about another.
      expect(afterDrop.filter(s => s.packageSessionSlotId === tuesdaySlotId)).toHaveLength(2)

      // The booked Saturday SURVIVES. Deleting it would cascade the register and
      // this client's casual booking away, silently, from the person who most
      // needs telling — so it stays, orphaned (SetNull) and inert, for the
      // trainer to cancel or move with the per-occurrence tools once they can
      // see who is in it.
      const survivor = afterDrop.find(s => s.id === saturdaySessions[0].id)
      expect(survivor, 'a session somebody has booked is never deleted').toBeTruthy()
      expect(survivor!.packageSessionSlotId).toBeNull()

      // The empty Saturday is gone, not orphaned.
      expect(afterDrop.some(s => s.id === saturdaySessions[1].id)).toBe(false)
      expect(afterDrop).toHaveLength(3)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('a slot cannot borrow another business’s venue or staff', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      // Business B's private venue — Business A must not be able to attach it.
      const rivalOwner = await prisma.user.findUnique({ where: { email: SEED.businessB.ownerEmail }, select: { id: true } })
      const rival = await prisma.trainerProfile.findFirst({ where: { userId: rivalOwner!.id }, select: { id: true } })
      const rivalVenue = await prisma.location.create({
        data: { trainerId: rival!.id, name: 'Rival HQ', address: '9 Secret Lane' },
      })
      cleanup.push(() => prisma.location.delete({ where: { id: rivalVenue.id } }).catch(() => {}))
      const rivalMembership = await prisma.trainerMembership.findFirst({
        where: { companyId: rival!.id },
        select: { id: true },
      })

      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Cross-tenant Slot',
          sessionCount: 1,
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          sessionSlots: [{
            day: 2, startTime: '15:00', endTime: '17:00',
            locationId: rivalVenue.id,
            assignedMembershipIds: rivalMembership ? [rivalMembership.id] : [],
          }],
        },
      })
      // The save succeeds — one stale id shouldn't fail an otherwise-valid
      // schedule — but the cross-tenant references are dropped, not stored.
      expect(res.status(), await res.text()).toBe(201)
      const pkgId = (await res.json()).id as string
      cleanup.push(() => prisma.package.delete({ where: { id: pkgId } }).catch(() => {}))

      const slots = await prisma.packageSessionSlot.findMany({ where: { packageId: pkgId } })
      expect(slots).toHaveLength(1)
      expect(slots[0].locationId, 'must not attach another business’s venue').toBeNull()
      expect(slots[0].assignedMembershipIds, 'must not assign another business’s staff').toEqual([])
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
