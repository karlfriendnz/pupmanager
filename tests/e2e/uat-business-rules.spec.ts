import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { bestEffort } from './cleanup'

// User acceptance tests, written against docs/business-rules.md. Each title
// carries the rule id it proves, so a failure names the promise that broke
// rather than the function that threw.
//
// These cover rules that had no test of their own. Rules already proven
// elsewhere are cross-referenced in the document instead of duplicated here.

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE })

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

const inDays = (n: number) => new Date(Date.now() + n * 864e5)

/** A free group class the seeded client can enrol into. */
async function makeClass(page: Page, name: string, extra: Record<string, unknown> = {}) {
  const res = await page.request.post('/api/packages', {
    data: {
      name, sessionCount: 3, weeksBetween: 1, durationMins: 60, isGroup: true,
      capacity: 8, startAt: inDays(10).toISOString(), ...extra,
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return await res.json() as { id: string; classRunId: string }
}

test.describe('UAT — a household with several dogs', () => {
  // DOG-1 / DOG-4: the rule Karl named. If someone can own three dogs, they
  // have to be able to bring three dogs.
  test('DOG-4 · an owner enrols two dogs into one class in a single booking', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const second = `E2E Second Dog ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const b = await makeClass(page, `E2E Two Dogs ${Date.now()}`)
      // Outermost first — `cleanup` is run in REVERSE, and ClassRun→Package
      // RESTRICTs, so the package may only go once its run has.
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(bestEffort('package')))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(bestEffort('class run')))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class sessions')))
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class enrolments')))

      // The household gets a second dog (DOG-1).
      await login(page, SEED.client.email, SEED.client.password)
      const added = await page.request.post('/api/my/dogs', { data: { name: second } })
      expect(added.status()).toBe(201)
      const secondDog = await added.json() as { id: string }
      cleanup.push(() => prisma.dog.delete({ where: { id: secondDog.id } }).catch(bestEffort('second dog')))

      const profile = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId },
        select: { dogId: true },
      })
      const bothDogs = [profile!.dogId!, secondDog.id]

      // Both dogs, one booking (DOG-4).
      const enrol = await page.request.post(`/api/my/classes/${b.classRunId}/enroll`, {
        data: { type: 'FULL', dogIds: bothDogs },
      })
      expect(enrol.status(), await enrol.text()).toBe(201)

      // One enrolment per dog — not one booking covering two dogs, because the
      // roster, the capacity count and the invoice all count dogs.
      const enrolments = await prisma.classEnrollment.findMany({
        where: { classRunId: b.classRunId },
        select: { dogId: true, status: true },
      })
      expect(enrolments).toHaveLength(2)
      expect(enrolments.map(e => e.dogId).sort()).toEqual([...bothDogs].sort())
      for (const e of enrolments) expect(e.status).toBe('ENROLLED')
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('DOG-4 · the same dog listed twice is booked once, not charged twice', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const b = await makeClass(page, `E2E Dupe Dog ${Date.now()}`)
      // Outermost first — `cleanup` is run in REVERSE, and ClassRun→Package
      // RESTRICTs, so the package may only go once its run has.
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(bestEffort('package')))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(bestEffort('class run')))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class sessions')))
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class enrolments')))

      const profile = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId }, select: { dogId: true },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const enrol = await page.request.post(`/api/my/classes/${b.classRunId}/enroll`, {
        data: { type: 'FULL', dogIds: [profile!.dogId!, profile!.dogId!] },
      })
      expect(enrol.status(), await enrol.text()).toBe(201)

      expect(
        await prisma.classEnrollment.count({ where: { classRunId: b.classRunId } }),
        'the same dog twice must collapse to one enrolment',
      ).toBe(1)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // DOG-3: a dog is not a free-text field. You cannot book someone else's dog.
  test('DOG-3 · a dog from another household cannot be booked', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    let rivalDogId: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const b = await makeClass(page, `E2E Foreign Dog ${Date.now()}`)
      // Outermost first — `cleanup` is run in REVERSE, and ClassRun→Package
      // RESTRICTs, so the package may only go once its run has.
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(bestEffort('package')))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(bestEffort('class run')))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class sessions')))
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class enrolments')))

      // A dog belonging to somebody else entirely.
      rivalDogId = (await prisma.dog.create({
        data: { name: `E2E Not Yours ${Date.now()}`, clientProfileId: SEED.businessB.clientId },
      })).id

      await login(page, SEED.client.email, SEED.client.password)
      const enrol = await page.request.post(`/api/my/classes/${b.classRunId}/enroll`, {
        data: { type: 'FULL', dogIds: [rivalDogId] },
      })
      expect(enrol.status(), 'booking another household’s dog must be refused').toBe(400)
      expect(await prisma.classEnrollment.count({ where: { classRunId: b.classRunId } })).toBe(0)
    } finally {
      if (rivalDogId) await prisma.dog.delete({ where: { id: rivalDogId } }).catch(bestEffort('rival dog'))
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // BOOK-1 / BOOK-2 from the CLIENT's side: two dogs dropping into one session.
  test('DOG-4 · two dogs can drop into the same single session', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const second = `E2E Drop Dog ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const b = await makeClass(page, `E2E Two Dog Drop ${Date.now()}`, { allowDropIn: true, dropInPriceCents: 0 })
      // Outermost first — `cleanup` is run in REVERSE, and ClassRun→Package
      // RESTRICTs, so the package may only go once its run has.
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(bestEffort('package')))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(bestEffort('class run')))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class sessions')))
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(bestEffort('class enrolments')))

      const session = await prisma.trainingSession.findFirst({
        where: { classRunId: b.classRunId }, orderBy: { scheduledAt: 'asc' }, select: { id: true },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const added = await page.request.post('/api/my/dogs', { data: { name: second } })
      const secondDog = await added.json() as { id: string }
      cleanup.push(() => prisma.dog.delete({ where: { id: secondDog.id } }).catch(bestEffort('second dog')))

      const profile = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId }, select: { dogId: true },
      })

      const enrol = await page.request.post(`/api/my/classes/${b.classRunId}/enroll`, {
        data: { type: 'DROP_IN', sessionIds: [session!.id], dogIds: [profile!.dogId!, secondDog.id] },
      })
      expect(enrol.status(), await enrol.text()).toBe(201)

      const rows = await prisma.classEnrollment.findMany({
        where: { classRunId: b.classRunId },
        select: { dogId: true, dropInSessionId: true, type: true },
      })
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.type).toBe('DROP_IN')
        expect(r.dropInSessionId, 'each dog is booked onto the named session').toBe(session!.id)
      }
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // ACC-1: the same person, two trainers, two separate client records.
  test('ACC-1 · one person can be a client of two different trainers', async ({ page }) => {
    const prisma = await makePrisma()
    let secondProfileId: string | null = null
    try {
      const clientUser = await prisma.user.findUnique({
        where: { email: SEED.client.email }, select: { id: true },
      })
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })

      // The same login, a second trainer.
      secondProfileId = (await prisma.clientProfile.create({
        data: { userId: clientUser!.id, trainerId: rival!.id, status: 'ACTIVE' },
      })).id

      const both = await prisma.clientProfile.findMany({
        where: { userId: clientUser!.id }, select: { id: true, trainerId: true },
      })
      expect(both.length, 'one login should hold a record per trainer').toBeGreaterThanOrEqual(2)
      expect(new Set(both.map(b => b.trainerId)).size).toBe(both.length)

      // And they can still sign in and use the app with more than one.
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/home')
      const later = page.getByRole('button', { name: 'Maybe later' })
      if (await later.isVisible().catch(() => false)) await later.click()
      expect(page.url()).not.toContain('/login')
    } finally {
      if (secondProfileId) await prisma.clientProfile.delete({ where: { id: secondProfileId } }).catch(bestEffort('second client profile'))
      await prisma.$disconnect()
    }
  })
})
