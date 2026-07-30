import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Recurring memberships, Phase 2: what a client sees and can do when a payment
// fails, and the guards on the routes that fix it.
//
// The behaviour under test is Karl's call (2026-07-27): access stops on the
// FIRST failed payment, and comes back when a retry succeeds. So the assertions
// that matter are about the ROUND TRIP — a paused plan really does take the
// sessions away, and restoring really does hand all of them back.
//
// Nothing here talks to Stripe. The pause/restore is driven through the same
// database state the webhook produces, which is exactly what the client screens
// read; the Stripe half is covered by the unit tests and, before this ships,
// by the test-clock scripts.

test.use({ viewport: { width: 1280, height: 900 } })

const MEMBERSHIP_ID = 'e2ep2membership00000000x'
const PLAN_ID = 'e2ep2plan0000000000000x'
const PURCHASE_ID = 'e2ep2purchase000000000x'

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
  const maybeLater = page.getByRole('button', { name: 'Maybe later' })
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click()
}

type Db = Awaited<ReturnType<typeof makePrisma>>

/**
 * A client on a recurring plan, with one package assignment GRANTED by it —
 * so there is something real to take away and give back.
 */
async function seedSubscribedClient(prisma: Db, opts?: { status?: string; suspended?: boolean }) {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { businessName: 'E2E Dog School' }, select: { id: true },
  })
  if (!trainer) throw new Error('E2E Dog School trainer not seeded')

  await prisma.trainerProfile.update({
    where: { id: trainer.id },
    data: { connectAccountId: 'acct_e2e_p2', connectChargesEnabled: true, acceptPaymentsEnabled: true, recurringPaymentsEnabled: true, sandboxBilling: true },
  })

  await prisma.membership.create({
    data: {
      id: MEMBERSHIP_ID, trainerId: trainer.id, name: 'E2E Paused Plan',
      priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', published: true,
      plans: { create: [{ id: PLAN_ID, interval: 'MONTH', priceCents: 40000, order: 0 }] },
    },
  })

  const suspendedAt = opts?.suspended ? new Date() : null
  await prisma.membershipPurchase.create({
    data: {
      id: PURCHASE_ID, membershipId: MEMBERSHIP_ID, trainerId: trainer.id,
      clientId: SEED.assignedClientId, planId: PLAN_ID,
      status: (opts?.status ?? 'ACTIVE') as never,
      stripeSubscriptionId: 'sub_e2e_p2', stripeCustomerId: 'cus_e2e_p2',
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      cardLast4: '4242',
      accessPausedAt: suspendedAt,
      sandbox: true,
    },
  })

  // A package assignment granted BY the plan, with a session on it. This is the
  // thing that has to disappear and come back.
  const pkg = await prisma.package.findFirst({ where: { trainerId: trainer.id }, select: { id: true } })
  if (!pkg) throw new Error('no package seeded')
  const assignment = await prisma.clientPackage.create({
    data: {
      packageId: pkg.id, clientId: SEED.assignedClientId, startDate: new Date(),
      membershipPurchaseId: PURCHASE_ID, suspendedAt,
    },
  })
  await prisma.trainingSession.create({
    data: {
      trainerId: trainer.id, clientId: SEED.assignedClientId, clientPackageId: assignment.id,
      title: 'E2E Membership Session', scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      durationMins: 60, sessionType: 'IN_PERSON', status: 'UPCOMING',
    },
  })
  return trainer.id
}

async function cleanup(prisma: Db) {
  await prisma.trainingSession.deleteMany({ where: { title: 'E2E Membership Session' } })
  await prisma.clientPackage.deleteMany({ where: { membershipPurchaseId: PURCHASE_ID } })
  await prisma.membershipInvoice.deleteMany({ where: { membershipPurchaseId: PURCHASE_ID } })
  await prisma.membershipPurchase.deleteMany({ where: { id: PURCHASE_ID } })
  await prisma.membership.deleteMany({ where: { id: MEMBERSHIP_ID } })
  await prisma.trainerProfile.updateMany({
    where: { businessName: 'E2E Dog School' },
    data: { connectAccountId: null, recurringPaymentsEnabled: false },
  })
}

test.describe('a paused plan actually takes access away', () => {
  test('an ACTIVE plan shows its session and no warning', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma)
      await login(page, SEED.client.email, SEED.client.password)

      await page.goto('/my-sessions')
      await expect(page.getByText('E2E Membership Session')).toBeVisible()

      await page.goto('/my-memberships')
      await expect(page.getByText('E2E Paused Plan')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Update card' })).toHaveCount(0)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('a PAST_DUE plan hides the session and offers the fix', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma, { status: 'PAST_DUE', suspended: true })
      await login(page, SEED.client.email, SEED.client.password)

      // The session granted by the unpaid plan is gone from the client's view.
      // It is NOT deleted — it is still on the trainer's calendar.
      await page.goto('/my-sessions')
      await expect(page.getByText('E2E Membership Session')).toHaveCount(0)

      // And the plan says exactly what happened and how to fix it — losing
      // access with no explanation is the worst version of this.
      await page.goto('/my-memberships')
      await expect(page.getByText(/payment didn.t go through/i)).toBeVisible()
      await expect(page.getByText(/paused/i).first()).toBeVisible()
      await expect(page.getByText(/card ending 4242/i)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Update card' })).toBeVisible()
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('restoring the plan hands the session straight back', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma, { status: 'PAST_DUE', suspended: true })
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-sessions')
      await expect(page.getByText('E2E Membership Session')).toHaveCount(0)

      // What a successful Stripe retry does to the database.
      await prisma.membershipPurchase.update({
        where: { id: PURCHASE_ID },
        data: { status: 'ACTIVE', accessPausedAt: null, accessRestoredAt: new Date(), failedPaymentCount: 0 },
      })
      await prisma.clientPackage.updateMany({
        where: { membershipPurchaseId: PURCHASE_ID },
        data: { suspendedAt: null },
      })

      await page.goto('/my-sessions')
      await expect(page.getByText('E2E Membership Session')).toBeVisible()

      await page.goto('/my-memberships')
      await expect(page.getByText(/payment didn.t go through/i)).toHaveCount(0)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('an ORPHANED plan says the trainer left and that they aren’t being charged', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma, { status: 'ORPHANED', suspended: true })
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-memberships')

      // Must not imply the client did this, and must answer the thing they most
      // want to know.
      await expect(page.getByText(/trainer has stopped taking payments/i)).toBeVisible()
      await expect(page.getByText(/haven.t been charged again/i)).toBeVisible()
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })
})

test.describe('Phase 2 route guards', () => {
  test('cross-tenant: a client cannot update the card on someone else’s plan', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainerId = await seedSubscribedClient(prisma, { status: 'PAST_DUE', suspended: true })
      // The same trainer's OTHER client owns this one.
      const rivalId = 'e2ep2rival000000000000x'
      await prisma.membershipPurchase.create({
        data: {
          id: rivalId, membershipId: MEMBERSHIP_ID, trainerId,
          clientId: SEED.unassignedClientId, planId: PLAN_ID, status: 'PAST_DUE',
          stripeSubscriptionId: 'sub_e2e_rival', stripeCustomerId: 'cus_rival', sandbox: true,
        },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post(`/api/my/memberships/purchases/${rivalId}/update-card`, { data: {} })

      // 404 — the lookup is scoped to the caller's own clientId.
      expect(res.status()).toBe(404)

      await prisma.membershipPurchase.deleteMany({ where: { id: rivalId } })
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('a trainer cannot cancel another business’s subscription', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma)
      // Rival Dog Co's owner tries to cancel E2E Dog School's subscription.
      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      const res = await page.request.post(
        `/api/trainer/memberships/subscriptions/${PURCHASE_ID}/cancel`,
        { data: {} },
      )

      expect(res.status()).toBe(404)
      const after = await prisma.membershipPurchase.findUnique({ where: { id: PURCHASE_ID } })
      expect(after?.status).toBe('ACTIVE')
      expect(after?.cancelAtPeriodEnd).toBe(false)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('payments cannot be switched off while clients are on ongoing plans', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedSubscribedClient(prisma)
      await login(page, SEED.owner.email, SEED.owner.password)

      // Switching the toggle off would NOT stop the subscriptions — they live
      // on the trainer's Stripe account and would keep charging.
      const res = await page.request.patch('/api/connect/account', {
        data: { acceptPaymentsEnabled: false },
      })

      expect(res.status()).toBe(409)
      expect((await res.json()).error).toMatch(/ongoing plan/i)

      const trainer = await prisma.trainerProfile.findFirst({ where: { businessName: 'E2E Dog School' } })
      expect(trainer?.acceptPaymentsEnabled).toBe(true)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('the reconciliation cron refuses an unauthenticated call', async ({ page }) => {
    const res = await page.request.get('/api/cron/membership-reconcile')
    expect(res.status()).toBe(401)
  })
})
