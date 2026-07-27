import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Saving a group offering with a start date SCHEDULES it, not just defines it.
//
// The bug this exists to prevent: the offerings wizard posted to /api/packages,
// which created a Package and nothing else. /classes and /events list ClassRuns
// — so a class created through the wizard existed in the database and appeared
// on no page in the app. The trainer's date, venue, photo and staff were all
// discarded on the way through.
//
// Also pins the routing rule that keeps the three lists disjoint: a recurring
// class, a drop-in and a one-off event are all ClassRuns, and each must appear
// on exactly one page.

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

const inDays = (n: number) => new Date(Date.now() + n * 864e5)

test.describe('an offering with a start date is scheduled', () => {
  test('a group class gets its run, sessions, venue, photo and staff', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      const trainer = await prisma.trainerProfile.findFirst({ where: { userId: owner!.id }, select: { id: true } })
      const trainerId = trainer!.id
      const membership = await prisma.trainerMembership.findFirst({
        where: { companyId: trainerId }, select: { id: true },
      })

      await login(page, SEED.owner.email, SEED.owner.password)

      const startAt = inDays(10)
      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Scheduled Class',
          sessionCount: 4,
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          capacity: 8,
          priceCents: 12000,
          startAt: startAt.toISOString(),
          scheduleNote: 'Tuesdays 6pm',
          location: '12 Training Field Rd',
          imageUrl: 'https://example.com/cover.jpg',
          assignedMembershipIds: membership ? [membership.id] : [],
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const body = await res.json()
      const pkgId = body.id as string
      cleanup.push(() => prisma.package.delete({ where: { id: pkgId } }).catch(() => {}))

      // The response tells the caller where the thing now lives.
      expect(body.classRunId, 'a scheduled offering must report its run').toBeTruthy()
      cleanup.push(() => prisma.classRun.delete({ where: { id: body.classRunId } }).catch(() => {}))

      const run = await prisma.classRun.findUnique({
        where: { id: body.classRunId },
        include: {
          sessions: { orderBy: { scheduledAt: 'asc' } },
          assignedTrainers: { select: { membershipId: true } },
        },
      })
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: body.classRunId } }).catch(() => {}))

      // Everything the trainer typed survived the save.
      expect(run!.scheduleNote).toBe('Tuesdays 6pm')
      expect(run!.location).toBe('12 Training Field Rd')
      expect(run!.imageUrl).toBe('https://example.com/cover.jpg')
      expect(run!.startDate.getTime()).toBe(startAt.getTime())
      if (membership) expect(run!.assignedTrainers.map(t => t.membershipId)).toEqual([membership.id])

      // And it has a real session series, at the run's venue.
      expect(run!.sessions).toHaveLength(4)
      expect(run!.sessions.map(s => s.sessionIndex)).toEqual([1, 2, 3, 4])
      expect(run!.sessions.every(s => s.location === '12 Training Field Rd')).toBe(true)
      // A week apart, from the start date.
      expect(run!.sessions[1].scheduledAt.getTime() - run!.sessions[0].scheduledAt.getTime()).toBe(7 * 864e5)

      // It shows on /classes — the whole point.
      await page.goto('/classes')
      await expect(page.getByText('E2E Scheduled Class')).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('an event carries its ticket types and lands on /events, not /classes', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      // Events is opt-in (no defaultOn) — global-setup enables it, along with
      // the BillingItem its TrainerAddon FKs to.
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Recall Workshop',
          sessionCount: 1,
          weeksBetween: 0,
          durationMins: 180,
          isGroup: true,
          isEvent: true,
          capacity: 20,
          startAt: inDays(14).toISOString(),
          location: 'Community Hall',
          ticketTiers: [
            { name: 'Early bird', priceCents: 4000, capacity: 10 },
            { name: 'General', priceCents: 6000 },
            // A blank row — the editor always shows one; it must not be stored.
            { name: '   ' },
          ],
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const body = await res.json()
      cleanup.push(() => prisma.package.delete({ where: { id: body.id } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: body.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: body.classRunId } }).catch(() => {}))

      const tiers = await prisma.packageTicketTier.findMany({
        where: { packageId: body.id }, orderBy: { order: 'asc' },
      })
      expect(tiers.map(t => [t.name, t.priceCents, t.capacity])).toEqual([
        ['Early bird', 4000, 10],
        ['General', 6000, null],
      ])

      // One session, because an event happens once.
      expect(await prisma.trainingSession.count({ where: { classRunId: body.classRunId } })).toBe(1)

      // Listed as an event…
      await page.goto('/events')
      await expect(page.getByText('E2E Recall Workshop')).toBeVisible({ timeout: 15_000 })
      // …and NOT as a class. Both pages read ClassRuns, so this is the check
      // that keeps one thing from appearing in two places.
      await page.goto('/classes')
      await expect(page.getByText('E2E Recall Workshop')).toHaveCount(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('a drop-in schedules itself off its slots, with no start date of its own', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      // No startAt in the payload at all — a drop-in has no such field.
      const from = inDays(9).toISOString().slice(0, 10)
      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Slot-scheduled Drop-in',
          sessionCount: 1,
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          sessionSlots: [{
            startDate: from, day: new Date(`${from}T00:00:00.000Z`).getUTCDay(),
            startTime: '10:00', endTime: '11:00', priceCents: 2000,
            recurrenceRule: 'FREQ=WEEKLY;COUNT=3',
          }],
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const body = await res.json()
      cleanup.push(() => prisma.package.delete({ where: { id: body.id } }).catch(() => {}))

      // It still got a run — derived from the slot's "Starts from".
      expect(body.classRunId, 'a drop-in must still be scheduled').toBeTruthy()
      cleanup.push(() => prisma.classRun.delete({ where: { id: body.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: body.classRunId } }).catch(() => {}))

      expect(await prisma.trainingSession.count({ where: { classRunId: body.classRunId } })).toBe(3)

      // Drop-ins (now "casual classes") have their own page, and stay off the
      // group-classes list.
      await page.goto('/casual-classes')
      await expect(page.getByText('E2E Slot-scheduled Drop-in')).toBeVisible({ timeout: 15_000 })
      await page.goto('/classes')
      await expect(page.getByText('E2E Slot-scheduled Drop-in')).toHaveCount(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('an offering with no start date is defined but not scheduled', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      // A 1:1 package is a template — it must never create a run.
      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Plain Package', sessionCount: 6, weeksBetween: 1, durationMins: 60, isGroup: false },
      })
      expect(res.status()).toBe(201)
      const body = await res.json()
      cleanup.push(() => prisma.package.delete({ where: { id: body.id } }).catch(() => {}))

      expect(body.classRunId).toBeNull()
      expect(await prisma.classRun.count({ where: { packageId: body.id } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // …but "not scheduled" must not mean "your answers were thrown away". The
  // venue used to live only on the ClassRun, so an offering defined before it
  // was scheduled accepted the address, saved 201, and lost it.
  test('a venue typed before the class is scheduled survives, and the run inherits it', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const created = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Unscheduled Venue',
          sessionCount: 2, weeksBetween: 1, durationMins: 60,
          isGroup: true,
          location: '9 Riverbank Road',
          // No startAt — defined, not scheduled. Nothing to hold the venue.
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      const pkg = await created.json()
      cleanup.push(() => prisma.package.delete({ where: { id: pkg.id } }).catch(() => {}))

      expect(pkg.classRunId).toBeNull()
      expect(await prisma.classRun.count({ where: { packageId: pkg.id } })).toBe(0)
      // The whole point: it is still there.
      const stored = await prisma.package.findUnique({
        where: { id: pkg.id }, select: { location: true },
      })
      expect(stored?.location, 'the venue must not be discarded').toBe('9 Riverbank Road')

      // Schedule it later, saying nothing about where — it inherits.
      const scheduled = await page.request.post('/api/class-runs', {
        data: {
          packageId: pkg.id,
          name: 'E2E Unscheduled Venue — Term 1',
          startDate: inDays(20).toISOString(),
        },
      })
      expect(scheduled.status(), await scheduled.text()).toBe(201)
      const run = await scheduled.json()
      cleanup.push(() => prisma.classRun.delete({ where: { id: run.id } }).catch(() => {}))

      const runRow = await prisma.classRun.findUnique({
        where: { id: run.id }, select: { location: true },
      })
      expect(runRow?.location).toBe('9 Riverbank Road')
      // Sessions carry it too — that address is what the client is told.
      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId: run.id }, select: { location: true },
      })
      expect(sessions.length).toBeGreaterThan(0)
      for (const s of sessions) expect(s.location).toBe('9 Riverbank Road')

      // A second cohort naming its own venue keeps it, and the first is
      // untouched — inheritance is a default, not a rewrite.
      const second = await page.request.post('/api/class-runs', {
        data: {
          packageId: pkg.id,
          name: 'E2E Unscheduled Venue — Term 2',
          startDate: inDays(90).toISOString(),
          location: 'The scout hall',
        },
      })
      expect(second.status(), await second.text()).toBe(201)
      const run2 = await second.json()
      cleanup.push(() => prisma.classRun.delete({ where: { id: run2.id } }).catch(() => {}))

      expect((await prisma.classRun.findUnique({
        where: { id: run2.id }, select: { location: true },
      }))?.location).toBe('The scout hall')
      expect((await prisma.classRun.findUnique({
        where: { id: run.id }, select: { location: true },
      }))?.location).toBe('9 Riverbank Road')
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})

test.describe('editing a scheduled offering moves the class', () => {
  test('venue, note, cover and staff round-trip to the run and its sessions', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const created = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Editable Class',
          sessionCount: 3, weeksBetween: 1, durationMins: 60,
          isGroup: true,
          startAt: inDays(12).toISOString(),
          scheduleNote: 'Mondays 5pm',
          location: 'Old Field',
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      const { id: pkgId, classRunId } = await created.json()
      cleanup.push(() => prisma.package.delete({ where: { id: pkgId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId } }).catch(() => {}))

      // Backdate one session so we can prove history is left alone.
      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId }, orderBy: { scheduledAt: 'asc' }, select: { id: true },
      })
      await prisma.trainingSession.update({
        where: { id: sessions[0].id },
        data: { scheduledAt: inDays(-3) },
      })

      const patched = await page.request.patch(`/api/packages/${pkgId}`, {
        data: {
          name: 'E2E Renamed Class',
          scheduleNote: 'Wednesdays 6pm',
          location: 'New Field',
          imageUrl: 'https://example.com/new-cover.jpg',
        },
      })
      expect(patched.status(), await patched.text()).toBe(200)

      const run = await prisma.classRun.findUnique({ where: { id: classRunId } })
      expect(run!.name).toBe('E2E Renamed Class')
      expect(run!.scheduleNote).toBe('Wednesdays 6pm')
      expect(run!.location).toBe('New Field')
      expect(run!.imageUrl).toBe('https://example.com/new-cover.jpg')

      const after = await prisma.trainingSession.findMany({
        where: { classRunId }, orderBy: { scheduledAt: 'asc' },
        select: { id: true, location: true, title: true },
      })
      // The session that has already happened keeps where it was actually held.
      expect(after[0].location).toBe('Old Field')
      // The ones still to come moved.
      expect(after.slice(1).every(s => s.location === 'New Field')).toBe(true)
      // Titles follow the new name.
      expect(after.every(s => s.title.startsWith('E2E Renamed Class'))).toBe(true)

      // And the renamed class reads correctly on the list.
      await page.goto('/classes')
      await expect(page.getByText('E2E Renamed Class')).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('a package running several cohorts keeps them out of the offering form', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      const trainer = await prisma.trainerProfile.findFirst({ where: { userId: owner!.id }, select: { id: true } })

      await login(page, SEED.owner.email, SEED.owner.password)

      const created = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Multi-cohort', sessionCount: 2, weeksBetween: 1, durationMins: 60,
          isGroup: true, startAt: inDays(12).toISOString(), location: 'Field A',
        },
      })
      const { id: pkgId, classRunId } = await created.json()
      cleanup.push(() => prisma.package.delete({ where: { id: pkgId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: classRunId } }).catch(() => {}))

      // A second cohort off the same offering (the autumn intake).
      const second = await prisma.classRun.create({
        data: {
          trainerId: trainer!.id, packageId: pkgId, name: 'E2E Multi-cohort',
          startDate: inDays(90), location: 'Field B',
        },
      })
      cleanup.push(() => prisma.classRun.delete({ where: { id: second.id } }).catch(() => {}))

      const patched = await page.request.patch(`/api/packages/${pkgId}`, {
        data: { location: 'Field C' },
      })
      expect(patched.status()).toBe(200)

      // Neither cohort moved — with two runs the form can't say which you meant,
      // so they stay under the control of their own class pages.
      expect((await prisma.classRun.findUnique({ where: { id: classRunId } }))!.location).toBe('Field A')
      expect((await prisma.classRun.findUnique({ where: { id: second.id } }))!.location).toBe('Field B')
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
