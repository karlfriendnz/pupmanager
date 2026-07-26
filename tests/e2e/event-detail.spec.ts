import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// An event has its own screen at /events/[eventId].
//
// It used to be rendered by the group-class screen at /classes/[runId] — events
// are ClassRuns underneath — which caused three separate reports from Karl:
//   * the price shown was wrong (one figure for an offering selling three);
//   * a "Sessions" list appeared for something that happens once;
//   * clicking an event lit up Group Classes in the sidebar.
// All three are the same cause. This spec pins the fix, including the legacy
// /classes/<eventId> links in sent emails and push deep links still working.

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

/** A one-off event selling three ticket types, at a flat package price that is
 *  deliberately none of them — the exact shape that read wrong. */
async function createEvent(page: Page) {
  const res = await page.request.post('/api/packages', {
    data: {
      name: 'E2E Ticketed Workshop',
      sessionCount: 1,
      weeksBetween: 0,
      durationMins: 120,
      isGroup: true,
      capacity: 30,
      priceCents: 4500,
      startAt: inDays(21).toISOString(),
      location: 'Bethlehem Hall',
      ticketTiers: [
        { name: 'Early bird', priceCents: 4000, capacity: 2 },
        { name: 'General', priceCents: 6000 },
        { name: 'VIP', priceCents: 12300 },
      ],
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return await res.json() as { id: string; classRunId: string }
}

test.describe('the event detail screen', () => {
  test('shows every ticket price, and no session list', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      await page.goto(`/events/${ev.classRunId}`)
      await expect(page.getByRole('heading', { name: 'E2E Ticketed Workshop' })).toBeVisible({ timeout: 15_000 })

      // All three prices, not one of them and not a range.
      await expect(page.getByText('Early bird', { exact: true })).toBeVisible()
      await expect(page.getByText('$40.00', { exact: true })).toBeVisible()
      await expect(page.getByText('$60.00', { exact: true })).toBeVisible()
      await expect(page.getByText('$123.00', { exact: true })).toBeVisible()

      // The offering's flat price is NOT quoted alongside them — that mismatch
      // ("the price shown is different from the real one") is the report.
      await expect(page.getByText('$45.00', { exact: true })).toHaveCount(0)

      // No sessions section: an event is one occasion.
      await expect(page.getByRole('heading', { name: /^Sessions/ })).toHaveCount(0)

      // And the back link goes to Events, not Classes.
      await expect(page.getByRole('link', { name: 'Events' }).first()).toBeVisible()
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // Sent emails, push deep links and the offering editor's Back link all carry
  // the old URL. Breaking them to move the page would be worse than the bug.
  test('the old /classes URL for an event redirects to /events', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      await page.goto(`/classes/${ev.classRunId}`)
      await page.waitForURL(`**/events/${ev.classRunId}`, { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: 'E2E Ticketed Workshop' })).toBeVisible()
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('enrolling on a chosen ticket bills that price times the quantity', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      const vip = await prisma.packageTicketTier.findFirst({ where: { packageId: ev.id, name: 'VIP' } })

      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          ticketTierId: vip!.id,
          quantity: 2,
          notify: false,
          sendInvoice: false,
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const { enrollmentId } = await res.json() as { enrollmentId: string }
      cleanup.push(() => prisma.invoice.deleteMany({ where: { sourceId: enrollmentId } }).catch(() => {}))
      cleanup.push(() => prisma.classEnrollment.delete({ where: { id: enrollmentId } }).catch(() => {}))

      const enrolment = await prisma.classEnrollment.findUnique({ where: { id: enrollmentId } })
      expect(enrolment?.ticketTierId).toBe(vip!.id)
      expect(enrolment?.quantity).toBe(2)

      // The whole point: the money follows the ticket, not the package price.
      const invoice = await prisma.invoice.findFirst({
        where: { sourceType: 'CLASS_ENROLLMENT', sourceId: enrollmentId },
        include: { lines: true },
      })
      expect(invoice?.amountCents).toBe(24600)
      expect(invoice?.lines[0]).toMatchObject({ quantity: 2, unitAmountCents: 12300, amountCents: 24600 })
      expect(invoice?.description).toContain('VIP × 2')
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('a ticket type sold out on its own cap is refused', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      // Early bird is capped at 2 — three of them must not go through, even
      // though the event itself has 30 places.
      const early = await prisma.packageTicketTier.findFirst({ where: { packageId: ev.id, name: 'Early bird' } })
      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: { clientId: SEED.assignedClientId, ticketTierId: early!.id, quantity: 3, notify: false },
      })
      expect(res.status()).toBe(409)
      expect((await res.text()).toLowerCase()).toContain('early bird')
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('another business cannot open this trainer’s event', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: ev.id } }).catch(() => {}))

      // A rival trainer knowing the id gets nothing.
      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      const res = await page.request.get(`/events/${ev.classRunId}`)
      expect(res.status()).toBe(404)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // The reverse of the redirect: a group class is not an event, and rendering it
  // as one would silently drop its sessions and its single price.
  test('a group class is not served by the events route', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Not An Event',
          sessionCount: 4,
          weeksBetween: 1,
          durationMins: 60,
          isGroup: true,
          startAt: inDays(10).toISOString(),
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const cls = await res.json() as { id: string; classRunId: string }
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: cls.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: cls.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: cls.id } }).catch(() => {}))

      const at = await page.request.get(`/events/${cls.classRunId}`)
      expect(at.status()).toBe(404)

      // …and it still opens on its own screen, sessions and all.
      await page.goto(`/classes/${cls.classRunId}`)
      await expect(page.getByRole('heading', { name: /^Sessions/ })).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
