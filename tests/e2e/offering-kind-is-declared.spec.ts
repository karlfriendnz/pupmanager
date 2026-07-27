import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// What an offering IS must be declared, never inferred from its shape.
//
// "Event" used to mean a shape: a group package with allowDropIn false,
// sessionCount 1 and no recurrenceRule. An ordinary group class that runs once
// has exactly that shape — and the class form's "Doesn't repeat (one-off)"
// option writes it — so those classes were filtered OFF /classes and listed
// under /events instead. A live customer could see 8 of her 63 group classes;
// the other 55 (Scent Detection Progression, Mantrailing Progression, Scent
// Walks) had silently become "events". Worse, the offering editor re-derived
// the kind the same way, so opening one and pressing Save made it permanent.
//
// Package.isEvent now records the trainer's intent at creation and every screen
// reads it back verbatim. These four tests are the contract:
//   1. a one-session GROUP CLASS stays on /classes and off /events;
//   2. an offering created AS AN EVENT lands on /events and off /classes;
//   3. editing and saving that class does not convert it;
//   4. one business still cannot open another's event.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

const inDays = (n: number) => new Date(Date.now() + n * 864e5)

type Created = { id: string; classRunId: string }

/** Create an offering through the real API the offering form posts to. */
async function createOffering(page: Page, data: Record<string, unknown>): Promise<Created> {
  const res = await page.request.post('/api/packages', { data })
  expect(res.status(), await res.text()).toBe(201)
  return await res.json() as Created
}

async function cleanUp(prisma: Awaited<ReturnType<typeof makePrisma>>, made: Created[]) {
  for (const m of made) {
    await prisma.trainingSession.deleteMany({ where: { classRunId: m.classRunId } }).catch(() => {})
    await prisma.classRun.deleteMany({ where: { id: m.classRunId } }).catch(() => {})
    await prisma.package.deleteMany({ where: { id: m.id } }).catch(() => {})
  }
}

test.describe('an offering is the kind it was created as', () => {
  test('a group class that runs ONCE stays a class — the regression', async ({ page }) => {
    const prisma = await makePrisma()
    const made: Created[] = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      // Exactly the shape that used to be read as an event: a group offering,
      // not drop-in, one session, no recurrence. Created as a CLASS — nothing
      // says isEvent — which is what the class form and the offering form's
      // "Group class" card both send.
      const name = `E2E Scent Detection Progression ${Date.now()}`
      const cls = await createOffering(page, {
        name,
        sessionCount: 1,
        weeksBetween: 1,
        durationMins: 90,
        isGroup: true,
        capacity: 10,
        priceCents: 6000,
        startAt: inDays(11).toISOString(),
      })
      made.push(cls)

      // The database says class, not event.
      const stored = await prisma.package.findUnique({ where: { id: cls.id } })
      expect(stored!.isEvent, 'created as a class, so it is not an event').toBe(false)

      // It is on the screen the trainer created it on…
      await page.goto('/classes')
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      // …and it has NOT been re-filed under Events.
      await page.goto('/events')
      await expect(page.getByText(name)).toHaveCount(0)

      // And its run opens as a class rather than redirecting to /events/…
      await page.goto(`/classes/${cls.classRunId}`)
      await expect(page).toHaveURL(new RegExp(`/classes/${cls.classRunId}`))
    } finally {
      await cleanUp(prisma, made)
      await prisma.$disconnect()
    }
  })

  test('the class form\'s "Doesn\'t repeat (one-off)" makes a CLASS — the customer\'s case', async ({ page }) => {
    const prisma = await makePrisma()
    let runId = ''
    let packageId = ''
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      // A single Saturday puppy socialisation. This is byte-for-byte what
      // ClassFormModal (the "Add class" flow off /schedule) posts when the
      // Repeats dropdown is on "Doesn't repeat (one-off)": its "0" sentinel
      // becomes sessionCount 1 with a harmless weeksBetween of 1. A one-off
      // class is a real product — enrolled, priced like a class — and it is not
      // an event just because it meets once. Fifty-five of one customer's
      // classes were created this way and every one of them disappeared.
      const name = `E2E Saturday Socialisation ${Date.now()}`
      const res = await page.request.post('/api/class-runs', {
        data: {
          name,
          startDate: inDays(10).toISOString(),
          sessionCount: 1,
          weeksBetween: 1,
          durationMins: 60,
          sessionType: 'IN_PERSON',
          capacity: 8,
          priceCents: 3500,
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const body = await res.json() as { id: string }
      runId = body.id

      const run = await prisma.classRun.findUnique({
        where: { id: runId },
        include: { package: true },
      })
      packageId = run!.packageId
      expect(run!.package.sessionCount, 'it really is a single-session run').toBe(1)
      expect(run!.package.isEvent, 'a one-off class is still a class').toBe(false)

      await page.goto('/classes')
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      await page.goto('/events')
      await expect(page.getByText(name)).toHaveCount(0)
    } finally {
      if (runId) {
        await prisma.trainingSession.deleteMany({ where: { classRunId: runId } }).catch(() => {})
        await prisma.classRun.deleteMany({ where: { id: runId } }).catch(() => {})
      }
      if (packageId) await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('an offering created as an event lands on Events, and not on Classes', async ({ page }) => {
    const prisma = await makePrisma()
    const made: Created[] = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const name = `E2E Recall Seminar ${Date.now()}`
      const event = await createOffering(page, {
        name,
        sessionCount: 1,
        weeksBetween: 0,
        durationMins: 120,
        isGroup: true,
        // The declaration. This is the whole difference from the test above —
        // the two offerings are otherwise identically shaped.
        isEvent: true,
        capacity: 30,
        priceCents: 4500,
        startAt: inDays(12).toISOString(),
      })
      made.push(event)

      const stored = await prisma.package.findUnique({ where: { id: event.id } })
      expect(stored!.isEvent).toBe(true)

      await page.goto('/events')
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      await page.goto('/classes')
      await expect(page.getByText(name)).toHaveCount(0)

      // The legacy /classes/<eventId> link (baked into sent emails and push
      // deep links) still redirects into the event screen.
      await page.goto(`/classes/${event.classRunId}`)
      await expect(page).toHaveURL(new RegExp(`/events/${event.classRunId}`), { timeout: 15_000 })
    } finally {
      await cleanUp(prisma, made)
      await prisma.$disconnect()
    }
  })

  test('opening a one-session class in the editor and saving leaves it a class', async ({ page }) => {
    const prisma = await makePrisma()
    const made: Created[] = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const name = `E2E Mantrailing Progression ${Date.now()}`
      const cls = await createOffering(page, {
        name,
        sessionCount: 1,
        weeksBetween: 1,
        durationMins: 90,
        isGroup: true,
        capacity: 12,
        priceCents: 7000,
        startAt: inDays(13).toISOString(),
      })
      made.push(cls)

      // The editor used to open this as a "One-off event" (it re-derived the
      // kind from the shape) and saving wrote that guess back to the row.
      await page.goto(`/packages/${cls.id}/edit`)
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible({ timeout: 15_000 })

      const saved = page.waitForResponse(r =>
        r.request().method() === 'PATCH' && r.url().includes(`/api/packages/${cls.id}`))
      await page.getByRole('button', { name: 'Save changes' }).click()
      expect((await saved).status()).toBe(200)

      // Saving changed nothing about WHAT IT IS.
      const after = await prisma.package.findUnique({ where: { id: cls.id } })
      expect(after!.isEvent, 'editing an offering must never change its kind').toBe(false)

      await page.goto('/classes')
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      await page.goto('/events')
      await expect(page.getByText(name)).toHaveCount(0)
    } finally {
      await cleanUp(prisma, made)
      await prisma.$disconnect()
    }
  })

  test("another business's event is not reachable at /events/[id]", async ({ page }) => {
    const prisma = await makePrisma()
    const made: Created[] = []
    try {
      // Business B creates a real event of its own.
      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      const bEvent = await createOffering(page, {
        name: `E2E Rival Workshop ${Date.now()}`,
        sessionCount: 1,
        weeksBetween: 0,
        durationMins: 60,
        isGroup: true,
        isEvent: true,
        capacity: 10,
        startAt: inDays(15).toISOString(),
      })
      made.push(bEvent)

      // Business A's owner, who has the events add-on, aims straight at its id.
      // The route scopes on trainerId, so it must 404 rather than render a
      // rival's guest list.
      await page.context().clearCookies()
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.goto(`/events/${bEvent.classRunId}`)
      expect(res?.status(), 'a rival event must not render').toBe(404)
    } finally {
      await cleanUp(prisma, made)
      await prisma.$disconnect()
    }
  })
})
