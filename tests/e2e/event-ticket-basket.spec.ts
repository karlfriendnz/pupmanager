import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Enrolling one client into an event holding SEVERAL ticket types at once —
// "3 general and 3 VIP" — as one action.
//
// The shape is one enrolment row per ticket type (each prices off its OWN tier
// and is capped by its OWN tier) tied together by a shared ticketGroupId, so it
// bills as ONE invoice with a line per ticket type. The two failures this spec
// exists to prevent: a ticket charged at the offering's flat price (the live bug
// fixed in d736544 — $45 taken for a $200 ticket) and a basket that half-books
// after the trainer has read a total back to the person in front of them.

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

type Prisma = Awaited<ReturnType<typeof makePrisma>>

const inDays = (n: number) => new Date(Date.now() + n * 864e5)

/** A one-off event selling three ticket types at three prices, with a flat
 *  offering price that is deliberately none of them, and one type capped well
 *  below the event's own capacity. */
async function createEvent(page: Page, over: Record<string, unknown> = {}) {
  const res = await page.request.post('/api/packages', {
    data: {
      name: 'E2E Ticket Basket Event',
      sessionCount: 1,
      weeksBetween: 0,
      durationMins: 120,
      isGroup: true,
      isEvent: true,
      capacity: 30,
      priceCents: 4500,
      startAt: inDays(24).toISOString(),
      location: 'Bethlehem Hall',
      ticketTiers: [
        { name: 'General entry', priceCents: 20000 },
        { name: 'VIP', priceCents: 12300 },
        { name: 'Other', priceCents: 8900, capacity: 2 },
      ],
      ...over,
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return await res.json() as { id: string; classRunId: string }
}

/** Tear the event down completely — specs share one seeded DB, so nothing this
 *  creates may survive into the next one's counts. */
function teardown(prisma: Prisma, ev: { id: string; classRunId: string }) {
  return async () => {
    const enrolments = await prisma.classEnrollment.findMany({
      where: { classRunId: ev.classRunId }, select: { id: true },
    }).catch(() => [] as { id: string }[])
    const ids = enrolments.map(e => e.id)
    if (ids.length) {
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { sourceId: { in: ids } } } }).catch(() => {})
      await prisma.invoice.deleteMany({ where: { sourceType: 'CLASS_ENROLLMENT', sourceId: { in: ids } } }).catch(() => {})
    }
    await prisma.classEnrollment.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {})
    await prisma.trainingSession.deleteMany({ where: { classRunId: ev.classRunId } }).catch(() => {})
    await prisma.classRun.delete({ where: { id: ev.classRunId } }).catch(() => {})
    await prisma.package.delete({ where: { id: ev.id } }).catch(() => {})
  }
}

const tierId = async (prisma: Prisma, packageId: string, name: string) =>
  (await prisma.packageTicketTier.findFirstOrThrow({ where: { packageId, name } })).id

test.describe('enrolling a client on several ticket types at once', () => {
  test('3 general and 3 VIP is one invoice, a line per ticket, at the right total', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))

      const general = await tierId(prisma, ev.id, 'General entry')
      const vip = await tierId(prisma, ev.id, 'VIP')
      const other = await tierId(prisma, ev.id, 'Other')

      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          tickets: [
            { ticketTierId: general, quantity: 3 },
            // A stepper the trainer never touched is not a purchase.
            { ticketTierId: other, quantity: 0 },
            { ticketTierId: vip, quantity: 3 },
          ],
          notify: false,
          sendInvoice: false,
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      expect((await res.json() as { booked: number }).booked).toBe(2)

      // One row per ticket type — and nothing at all for the type left at 0.
      const rows = await prisma.classEnrollment.findMany({
        where: { classRunId: ev.classRunId },
        orderBy: { enrolledAt: 'asc' },
      })
      expect(rows).toHaveLength(2)
      expect(rows.map(r => [r.ticketTierId, r.quantity])).toEqual([[general, 3], [vip, 3]])
      expect(rows.every(r => r.status === 'ENROLLED')).toBe(true)
      // Tied together, so the money reads as one purchase.
      expect(rows[0].ticketGroupId).toBeTruthy()
      expect(rows[1].ticketGroupId).toBe(rows[0].ticketGroupId)

      // ONE invoice covering both, with a line per ticket type. 3 × $200 +
      // 3 × $123 = $969 — never the offering's $45 flat price.
      const invoices = await prisma.invoice.findMany({
        where: { sourceType: 'CLASS_ENROLLMENT', sourceId: { in: rows.map(r => r.id) } },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })
      expect(invoices).toHaveLength(1)
      expect(invoices[0].amountCents).toBe(96_900)
      expect(invoices[0].lines).toHaveLength(2)
      expect(invoices[0].lines[0]).toMatchObject({ quantity: 3, unitAmountCents: 20000, amountCents: 60000 })
      expect(invoices[0].lines[0].description).toContain('General entry × 3')
      expect(invoices[0].lines[1]).toMatchObject({ quantity: 3, unitAmountCents: 12300, amountCents: 36900 })
      expect(invoices[0].lines[1].description).toContain('VIP × 3')
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // The whole reason this is one transaction: a total has already been read back
  // to the customer, so five of the six tickets plus an error is the worst
  // possible outcome.
  test('a ticket type without room refuses the whole basket, booking nothing', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))

      const general = await tierId(prisma, ev.id, 'General entry')
      // "Other" is capped at 2 while the event itself has 30 places.
      const other = await tierId(prisma, ev.id, 'Other')

      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          tickets: [
            { ticketTierId: general, quantity: 3 },
            { ticketTierId: other, quantity: 3 },
          ],
          notify: false,
        },
      })
      expect(res.status()).toBe(409)
      expect((await res.text()).toLowerCase()).toContain('other')

      // Not even the general tickets that would have fitted.
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('the basket still has to fit the event, however roomy each ticket type is', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      // Four places in the room; neither uncapped ticket type would object.
      const ev = await createEvent(page, { capacity: 4 })
      cleanup.push(teardown(prisma, ev))

      const general = await tierId(prisma, ev.id, 'General entry')
      const vip = await tierId(prisma, ev.id, 'VIP')

      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          tickets: [
            { ticketTierId: general, quantity: 3 },
            { ticketTierId: vip, quantity: 3 },
          ],
          notify: false,
        },
      })
      expect(res.status()).toBe(409)
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('enrolling into nothing at all is refused', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))
      const general = await tierId(prisma, ev.id, 'General entry')

      for (const tickets of [[], [{ ticketTierId: general, quantity: 0 }]]) {
        const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
          data: { clientId: SEED.assignedClientId, tickets, notify: false },
        })
        expect(res.status(), await res.text()).toBe(400)
      }
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // A tier id alone must never be enough to bill against another event's — or
  // another business's — ticket prices.
  test('a ticket type from another event is rejected, taking the basket with it', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))
      const other = await createEvent(page, { name: 'E2E Someone Else’s Event' })
      cleanup.push(teardown(prisma, other))

      const general = await tierId(prisma, ev.id, 'General entry')
      const strangerVip = await tierId(prisma, other.id, 'VIP')

      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          tickets: [
            { ticketTierId: general, quantity: 3 },
            { ticketTierId: strangerVip, quantity: 3 },
          ],
          notify: false,
        },
      })
      expect(res.status()).toBe(400)
      // Not even the valid half of the basket.
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('another business cannot enrol anyone on this event’s tickets', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))
      const general = await tierId(prisma, ev.id, 'General entry')

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      const res = await page.request.post(`/api/class-runs/${ev.classRunId}/enrollments`, {
        data: {
          clientId: SEED.assignedClientId,
          tickets: [{ ticketTierId: general, quantity: 3 }],
          notify: false,
        },
      })
      expect(res.status()).toBe(404)
      expect(await prisma.classEnrollment.count({ where: { classRunId: ev.classRunId } })).toBe(0)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('the enrol modal counts each ticket type and totals the lot', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const ev = await createEvent(page)
      cleanup.push(teardown(prisma, ev))

      // A phone is the primary layout for this screen.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/events/${ev.classRunId}`)
      await expect(page.getByRole('heading', { name: 'E2E Ticket Basket Event' })).toBeVisible({ timeout: 15_000 })

      await page.getByRole('button', { name: 'Enrol', exact: true }).first().click()
      // Step 1 is who; choosing the client IS the step.
      await page.getByRole('button', { name: SEED.client.name }).first().click()

      const total = page.getByTestId('ticket-basket-total')
      await expect(total).toHaveText('$0.00')

      // Three of one type and three of another — the thing that used to need
      // two trips through this form.
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'One more General entry' }).click()
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'One more VIP' }).click()
      await expect(total).toHaveText('$969.00')

      // The modal portals to <body>, so its submit is the last of the two.
      await page.getByRole('button', { name: 'Enrol', exact: true }).last().click()

      await expect
        .poll(() => prisma.classEnrollment.count({ where: { classRunId: ev.classRunId, status: 'ENROLLED' } }), { timeout: 20_000 })
        .toBe(2)

      // The guest list shows what they hold — BOTH types on their one row, not
      // just the first. Keeping only the first would hide half the money.
      await page.getByRole('button', { name: /Guest list/i }).first().click()
      await expect(page.getByText('General entry × 3 · VIP × 3')).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
