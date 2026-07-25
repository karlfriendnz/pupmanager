import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The client half of the most common paid flow after 1:1: a dog owner finds a
// class in Offerings and enrols themselves. self-book-wizard covers the 1:1 and
// membership types; this covers Group classes — enrolling in the whole course,
// and dropping into a single session of one that allows it.
//
// These go all the way THROUGH the confirm (unlike the 1:1 spec, which stops
// short) because the enrolment landing on the trainer's roster is the point.
// The suite is serial (workers: 1), and each test deletes what it made.

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

/** A free group class the client can join without a Stripe handoff. */
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

test.describe('a client enrols themselves from Offerings', () => {
  test('joins a whole class, and it lands on the trainer’s roster', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const name = `E2E Client Joins ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const b = await makeClass(page, name)
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')

      // Step 1 — the types menu, then the class itself.
      await page.getByRole('button', { name: /Group classes/ }).click()
      await page.getByRole('button', { name: new RegExp(name) }).click()

      // Step 2 — their dog is preselected, so Continue is live.
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()

      // Step 3 — free class, so it's a plain confirm rather than a Stripe hop.
      await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible()
      await page.getByRole('button', { name: 'Confirm & join' }).click()

      await expect(page.getByRole('heading', { name: /You're enrolled/ })).toBeVisible({ timeout: 20_000 })

      // The trainer's side of it: one FULL enrolment for the seeded client.
      const enrolment = await prisma.classEnrollment.findFirst({
        where: { classRunId: b.classRunId },
        select: { clientId: true, status: true, type: true },
      })
      expect(enrolment).toMatchObject({
        clientId: SEED.assignedClientId,
        status: 'ENROLLED',
        type: 'FULL',
      })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('drops into a single session of a casual class', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const name = `E2E Client Drops In ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      // Drop-in mode only engages when the class carries a per-session price;
      // 0 keeps it free, so the confirm stays in-app rather than hopping to
      // Stripe.
      const b = await makeClass(page, name, { allowDropIn: true, dropInPriceCents: 0 })
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId: b.classRunId }, orderBy: { scheduledAt: 'asc' }, select: { id: true },
      })
      expect(sessions.length).toBeGreaterThan(1)

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /Group classes/ }).click()
      await page.getByRole('button', { name: new RegExp(name) }).click()

      // A drop-in class opens straight into the session picker. Each row is a
      // button led by its number badge, so "1 …" is the first session.
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Pick the sessions you want')).toBeVisible()
      await page.getByRole('button', { name: /^1\s/ }).click()
      await page.getByRole('button', { name: /Continue · 1 session/ }).click()

      await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible()
      await page.getByRole('button', { name: /Confirm & join/ }).click()
      await expect(page.getByRole('heading', { name: /You're enrolled/ })).toBeVisible({ timeout: 20_000 })

      // A drop-in covers ONE session, so it's pinned to a session id.
      const enrolment = await prisma.classEnrollment.findFirst({
        where: { classRunId: b.classRunId },
        select: { type: true, dropInSessionId: true },
      })
      expect(enrolment?.type).toBe('DROP_IN')
      expect(sessions.map(s => s.id)).toContain(enrolment?.dropInSessionId)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
