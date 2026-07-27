import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '../../src/lib/feature-flags'

// The same offering, set up several ways, checked from both ends. A trainer
// configures it; a client meets the result. These are the variants that change
// what actually happens rather than just what it's called:
//
//   · a fixed-count package     → that many sessions, on the cadence
//   · an ongoing package        → one seed session, topped up later, NOT zero
//   · approval required         → a request, and no sessions until it's accepted
//   · a special price           → the special one is what's shown and charged
//
// Researched from the code first (see docs/business-rules.md), then written.

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

/** A self-bookable 1:1 package, configured however the scenario needs. */
async function makePackage(prisma: Awaited<ReturnType<typeof makePrisma>>, trainerId: string, data: Record<string, unknown>) {
  return prisma.package.create({
    data: {
      trainerId,
      name: `E2E Scenario ${Date.now()}-${Math.round(performance.now())}`,
      sessionCount: 1,
      weeksBetween: 1,
      durationMins: 60,
      clientSelfBook: true,
      selfBookRequiresApproval: false,
      ...data,
    },
  })
}

/**
 * A bookable slot inside the seeded 09:00–17:00 availability. Each test takes
 * its OWN day and hour: the whole suite shares one database and one trainer's
 * diary, so a fixed "next week at 10" collides with whatever an earlier spec
 * left in the calendar and self-booking answers "That time's just been taken".
 */
function freeSlot(daysOut: number, hour: number): string {
  const d = new Date(Date.now() + daysOut * 864e5)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

async function trainerId(prisma: Awaited<ReturnType<typeof makePrisma>>): Promise<string> {
  const t = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.owner.businessName }, select: { id: true },
  })
  return t!.id
}

test.describe('UAT — offerings set up several ways', () => {
  // SELL-1 / BOOK-4: a course of three lands as three sessions, spaced.
  test('a fixed-count package books all of its sessions on the cadence', async ({ page }) => {
    const prisma = await makePrisma()
    let pkgId: string | null = null
    try {
      const pkg = await makePackage(prisma, await trainerId(prisma), { sessionCount: 3, weeksBetween: 1 })
      pkgId = pkg.id

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post('/api/my/self-book', {
        data: { packageId: pkg.id, startDate: freeSlot(40, 11) },
      })
      expect(res.status(), await res.text()).toBe(201)

      const sessions = await prisma.trainingSession.findMany({
        where: { clientPackage: { packageId: pkg.id } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      })
      expect(sessions, 'three sessions for a three-session package').toHaveLength(3)

      // A week apart, as configured — not three on the same day.
      const gapDays = (sessions[1].scheduledAt.getTime() - sessions[0].scheduledAt.getTime()) / 864e5
      expect(Math.round(gapDays)).toBe(7)
    } finally {
      if (pkgId) {
        await prisma.trainingSession.deleteMany({ where: { clientPackage: { packageId: pkgId } } }).catch(() => {})
        await prisma.clientPackage.deleteMany({ where: { packageId: pkgId } }).catch(() => {})
        await prisma.package.delete({ where: { id: pkgId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // An ongoing package has no end. It must seed exactly one session — not none
  // (nothing to attend), and not a runaway (a calendar full of forever).
  test('an ongoing package seeds exactly one session, not zero and not many', async ({ page }) => {
    const prisma = await makePrisma()
    let pkgId: string | null = null
    try {
      const pkg = await makePackage(prisma, await trainerId(prisma), { sessionCount: 0, weeksBetween: 1 })
      pkgId = pkg.id

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post('/api/my/self-book', {
        data: { packageId: pkg.id, startDate: freeSlot(47, 12) },
      })
      expect(res.status(), await res.text()).toBe(201)

      const count = await prisma.trainingSession.count({
        where: { clientPackage: { packageId: pkg.id } },
      })
      expect(count, 'an ongoing package seeds one session and tops up later').toBe(1)
    } finally {
      if (pkgId) {
        await prisma.trainingSession.deleteMany({ where: { clientPackage: { packageId: pkgId } } }).catch(() => {})
        await prisma.clientPackage.deleteMany({ where: { packageId: pkgId } }).catch(() => {})
        await prisma.package.delete({ where: { id: pkgId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // The trainer wants the final say: nothing goes in the diary until they agree.
  test('an approval-required package makes a request, and no sessions yet', async ({ page }) => {
    const prisma = await makePrisma()
    let pkgId: string | null = null
    try {
      const pkg = await makePackage(prisma, await trainerId(prisma), {
        sessionCount: 2, selfBookRequiresApproval: true,
      })
      pkgId = pkg.id

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post('/api/my/self-book', {
        data: { packageId: pkg.id, startDate: freeSlot(54, 13) },
      })
      expect([200, 201], await res.text()).toContain(res.status())

      // A request exists…
      const request = await prisma.bookingRequest.findFirst({
        where: { packageId: pkg.id },
        select: { id: true, status: true, sessionDates: true },
      })
      expect(request, 'approval-required booking should raise a request').toBeTruthy()
      expect(request?.status).toBe('PENDING')
      // …carrying the times the client asked for, so accepting can honour them.
      expect((request?.sessionDates as unknown[])?.length).toBe(2)

      // …and nothing is in the diary yet.
      expect(
        await prisma.trainingSession.count({ where: { clientPackage: { packageId: pkg.id } } }),
        'nothing may be scheduled until the trainer accepts',
      ).toBe(0)
    } finally {
      if (pkgId) {
        await prisma.bookingRequest.deleteMany({ where: { packageId: pkgId } }).catch(() => {})
        await prisma.trainingSession.deleteMany({ where: { clientPackage: { packageId: pkgId } } }).catch(() => {})
        await prisma.clientPackage.deleteMany({ where: { packageId: pkgId } }).catch(() => {})
        await prisma.package.delete({ where: { id: pkgId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // PAY-6: a special price isn't decoration — it's the price.
  test('a special price is the one the client is shown', async ({ page }) => {
    const prisma = await makePrisma()
    let pkgId: string | null = null
    try {
      const pkg = await makePackage(prisma, await trainerId(prisma), {
        sessionCount: 1, priceCents: 20000, specialPriceCents: 9900,
      })
      pkgId = pkg.id

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      const later = page.getByRole('button', { name: 'Maybe later' })
      if (await later.isVisible().catch(() => false)) await later.click()

      await page.getByRole('button', { name: /1-on-1 sessions/ }).click()
      const card = page.getByRole('button', { name: new RegExp(pkg.name) })
      await expect(card).toBeVisible({ timeout: 15_000 })

      // The offer, not the list price.
      await expect(card).toContainText('$99')
      await expect(card, 'the full price must not be what they are quoted').not.toContainText('$200')
    } finally {
      if (pkgId) await prisma.package.delete({ where: { id: pkgId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // SELL-6 from both sides at once: the trainer can build a recurring
  // membership, and it stays out of the client's shop until it can be bought.
  test('a recurring membership is configurable by the trainer and invisible to clients', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    let membershipId: string | null = null
    const name = `E2E Recurring Scenario ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const created = await page.request.post('/api/trainer/memberships', {
        data: {
          name, priceCents: 0, cadence: 'RECURRING', published: true,
          plans: [
            { interval: 'WEEK', priceCents: 3000 },
            { interval: 'MONTH', priceCents: 11000, minTermCount: 3 },
          ],
          items: [],
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      membershipId = (await created.json()).id

      // The trainer's side keeps both options.
      const plans = await prisma.membershipPlan.findMany({ where: { membershipId: membershipId! } })
      expect(plans).toHaveLength(2)

      // The client's side offers neither — it isn't purchasable yet.
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      const later = page.getByRole('button', { name: 'Maybe later' })
      if (await later.isVisible().catch(() => false)) await later.click()
      await page.getByRole('button', { name: /Packages/ }).click()
      await expect(page.getByText(name)).toHaveCount(0)

      // And the buy route refuses it outright, link or no link.
      const buy = await page.request.post(`/api/my/memberships/${membershipId}/buy`, { data: {} })
      expect(buy.status(), 'a recurring membership must not be buyable yet').toBe(409)
    } finally {
      if (membershipId) await prisma.membership.delete({ where: { id: membershipId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
