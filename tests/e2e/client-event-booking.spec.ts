import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Events in the client booking wizard (/my-availability).
//
// Events are ClassRuns whose offering is a one-off, so they were silently
// landing in the wizard's "Group classes" list — and a TICKETED event was
// quoted there at the package price. That is the d736544 bug on the client
// side: a $123 ticket advertised at $45. Worse, /api/my/classes/[runId]/enroll
// now refuses any ticketed booking that doesn't name a tier, so the listing was
// not just wrong, it was unbookable.
//
// This spec pins: events get their own type; a ticketed one is priced by the
// ticket at every step; the package price never appears; and the booking
// actually goes through with the tier recorded against the enrolment.

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

/** A one-off event, optionally selling tickets, at a package price that is
 *  deliberately none of the ticket prices. */
async function createEvent(page: Page, name: string, tiers: { name: string; priceCents: number; capacity?: number }[]) {
  const res = await page.request.post('/api/packages', {
    data: {
      name,
      sessionCount: 1,
      weeksBetween: 0,
      durationMins: 90,
      isGroup: true,
      capacity: 30,
      priceCents: 4500,
      startAt: inDays(14).toISOString(),
      ...(tiers.length ? { ticketTiers: tiers } : {}),
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return await res.json() as { id: string; classRunId: string }
}

test.describe('client booking wizard — events', () => {
  test('a ticketed event is its own type, priced by the ticket, and books', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      // A free tier and two paid ones. The free tier is what the client takes,
      // so the booking completes here rather than disappearing into Stripe.
      const ev = await createEvent(page, 'E2E Client Event', [
        { name: 'Community place', priceCents: 0, capacity: 5 },
        { name: 'General entry', priceCents: 20000 },
        { name: 'VIP', priceCents: 12300, capacity: 2 },
      ])
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')

      // Its own type — not folded into Group classes.
      await page.getByRole('button', { name: /^Events/ }).click()
      await expect(page.getByText('E2E Client Event')).toBeVisible({ timeout: 15_000 })
      // The list quotes the CHEAPEST ticket, never the offering's $45.
      await expect(page.getByRole('main')).not.toContainText('$45')

      await page.getByRole('button', { name: /E2E Client Event/ }).click()

      // Every ticket type, at its own price.
      await expect(page.getByRole('main')).toContainText('General entry')
      await expect(page.getByRole('main')).toContainText('$200')
      await expect(page.getByRole('main')).toContainText('$123')
      // And still never the package price.
      await expect(page.getByRole('main')).not.toContainText('$45')

      // A paid tier quotes ITS price on the confirm step — the number that used
      // to come out as $45.
      await page.getByRole('button', { name: /VIP/ }).click()
      await page.getByRole('button', { name: /^Continue ·/ }).click()
      await expect(page.getByRole('main')).toContainText('$123')
      await expect(page.getByRole('main')).not.toContainText('$45')

      // Back, take the free place instead, and go through with it.
      await page.getByRole('button', { name: 'Back' }).click()
      await page.getByRole('button', { name: /Community place/ }).click()
      await page.getByRole('button', { name: /^Continue ·/ }).click()
      await page.getByRole('button', { name: /Confirm my place/ }).click()

      await expect(page.getByText(/You're going!/)).toBeVisible({ timeout: 20_000 })

      // The enrolment records the TIER, which is what any later invoice prices
      // from — without it the receivable falls back to the package price.
      const tiers = await prisma.packageTicketTier.findMany({ where: { packageId: ev.id } })
      const free = tiers.find(t => t.name === 'Community place')!
      const enrolment = await prisma.classEnrollment.findFirst({ where: { classRunId: ev.classRunId } })
      expect(enrolment?.ticketTierId).toBe(free.id)
      expect(enrolment?.quantity).toBe(1)
      expect(enrolment?.type).toBe('FULL')
    } finally {
      for (const fn of cleanup) await fn()
      await prisma.$disconnect()
    }
  })

  test('an event with no tickets keeps the offering price and still books', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page, 'E2E Free Meetup', [])
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))
      // No tiers, so the offering's own price IS the right number — but the
      // seeded trainer takes cards, and a paid confirm leaves for Stripe. Drop
      // it to free so the booking completes in-app.
      await prisma.package.update({ where: { id: ev.id }, data: { priceCents: 0 } })

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /^Events/ }).click()
      await page.getByRole('button', { name: /E2E Free Meetup/ }).click()

      // No ticket picker for an event that doesn't sell tickets.
      await expect(page.getByText('Which ticket?')).toHaveCount(0)
      await page.getByRole('button', { name: /^Continue$/ }).click()
      await page.getByRole('button', { name: /Confirm my place/ }).click()
      await expect(page.getByText(/You're going!/)).toBeVisible({ timeout: 20_000 })

      const enrolment = await prisma.classEnrollment.findFirst({ where: { classRunId: ev.classRunId } })
      expect(enrolment?.ticketTierId).toBeNull()
      expect(enrolment?.type).toBe('FULL')
    } finally {
      for (const fn of cleanup) await fn()
      await prisma.$disconnect()
    }
  })

  test('the API refuses a ticketed event booked without a tier — the wizard must always send one', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page, 'E2E Guard Event', [{ name: 'General', priceCents: 20000 }])
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      await login(page, SEED.client.email, SEED.client.password)
      // This is the request the OLD wizard would have made from its class list.
      const res = await page.request.post(`/api/my/classes/${ev.classRunId}/enroll`, {
        data: { type: 'FULL' },
      })
      expect(res.status()).toBe(400)
      expect(await res.text()).toContain('ticket type')
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup) await fn()
      await prisma.$disconnect()
    }
  })
})
