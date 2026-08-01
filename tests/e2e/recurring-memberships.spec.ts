import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '../../src/lib/feature-flags'

// Recurring client→trainer memberships, Phase 1: a client can subscribe to a
// recurring plan and cancel it.
//
// Two things shape this file:
//
// 1. The STOREFRONT is behind PACKAGES_HIDDEN_FROM_CLIENTS, so the buy-side UI
//    tests skip off that flag exactly like memberships.spec.ts does — flipping
//    it back restores the feature AND its coverage with no stale skip left
//    behind. The API-level guards are NOT behind the flag and always run.
//
// 2. "Your plans" (and therefore CANCELLING) is deliberately NOT behind that
//    flag. Someone already being charged every month must always be able to see
//    it and stop it; hiding a cancel button behind a display kill-switch is the
//    dark pattern self-serve cancellation exists to prevent. So the cancel
//    screen is testable through the real UI right now.
//
// Nothing here talks to Stripe. Confirming a cancellation calls the connected
// account, so these tests assert everything up to that point and leave the live
// round-trip to the test-clock scripts run by hand before a phase ships.

test.use({ viewport: { width: 1280, height: 900 } })

const RECURRING_ID = 'e2erecurringmembership00x'
const PLAN_ID = 'e2erecurringplan0000000x'
const WEEKLY_PLAN_ID = 'e2erecurringplanwk00000x'
const PURCHASE_ID = 'e2erecurringpurchase000x'
const RIVAL_PURCHASE_ID = 'e2erivalpurchase0000000x'

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
  await passIntakeGate(page)
  const maybeLater = page.getByRole('button', { name: 'Maybe later' })
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click()
}

async function passIntakeGate(page: Page) {
  const gate = page.getByRole('heading', { name: 'Before you get started' })
  if (!(await gate.isVisible({ timeout: 5_000 }).catch(() => false))) return
  const required = page.locator('input[placeholder="Required"], select[required]')
  const n = await required.count()
  for (let i = 0; i < n; i++) {
    const field = required.nth(i)
    const tag = await field.evaluate(el => el.tagName.toLowerCase())
    if (tag === 'select') await field.selectOption({ index: 1 })
    else await field.fill('E2E')
  }
  await page.getByRole('button', { name: /Save|Continue|Done/ }).first().click()
}

/** A published RECURRING membership with one monthly plan, on Business A. */
async function seedRecurring(prisma: Awaited<ReturnType<typeof makePrisma>>, opts?: { recurringOn?: boolean }) {
  const trainer = await prisma.trainerProfile.findFirst({ where: { businessName: 'E2E Dog School' }, select: { id: true } })
  if (!trainer) throw new Error('E2E Dog School trainer not seeded')

  await prisma.trainerProfile.update({
    where: { id: trainer.id },
    data: {
      // The seed leaves connectAccountId null, which would 409 long before the
      // recurring logic is reached.
      connectAccountId: 'acct_e2e_test',
      connectChargesEnabled: true,
      acceptPaymentsEnabled: true,
      recurringPaymentsEnabled: opts?.recurringOn ?? true,
      sandboxBilling: true,
    },
  })

  await prisma.membership.create({
    data: {
      id: RECURRING_ID,
      trainerId: trainer.id,
      name: 'E2E Ongoing Plan',
      description: 'Billed every month.',
      priceCents: 40000,
      cadence: 'RECURRING',
      interval: 'MONTH',
      published: true,
      plans: {
        create: [
          { id: PLAN_ID, interval: 'MONTH', priceCents: 40000, minTermCount: 3, earlyTermFeeCents: 5000, order: 0 },
          // A second billing option, so the picker has something to pick.
          { id: WEEKLY_PLAN_ID, interval: 'WEEK', priceCents: 12000, minTermCount: 0, earlyTermFeeCents: null, order: 1 },
        ],
      },
    },
  })
  return trainer.id
}

async function cleanup(prisma: Awaited<ReturnType<typeof makePrisma>>) {
  await prisma.membershipConsent.deleteMany({ where: { membershipId: RECURRING_ID } })
  await prisma.membershipPurchase.deleteMany({ where: { id: { in: [PURCHASE_ID, RIVAL_PURCHASE_ID] } } })
  await prisma.membershipPurchase.deleteMany({ where: { membershipId: RECURRING_ID } })
  await prisma.membership.deleteMany({ where: { id: RECURRING_ID } })
  await prisma.trainerProfile.updateMany({
    where: { businessName: 'E2E Dog School' },
    data: { connectAccountId: null, recurringPaymentsEnabled: false },
  })
}

test.describe('recurring memberships — buying', () => {
  test('a client must agree before a recurring charge can start', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedRecurring(prisma)
      await login(page, SEED.client.email, SEED.client.password)

      // No consent → refused outright. This is the guard that stops a stray tap
      // signing someone up to a repeating charge.
      const noConsent = await page.request.post(`/api/my/memberships/${RECURRING_ID}/buy`, {
        data: { consent: false },
      })
      expect(noConsent.status()).toBe(400)

      // And nothing was written — no consent row, no purchase.
      expect(await prisma.membershipConsent.count({ where: { membershipId: RECURRING_ID } })).toBe(0)
      expect(await prisma.membershipPurchase.count({ where: { membershipId: RECURRING_ID } })).toBe(0)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('a trainer who is not switched on for recurring cannot take one', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      // recurringPaymentsEnabled is the rollout allowlist now that the env var
      // is gone. Off means the old ask-your-trainer path, never a charge.
      await seedRecurring(prisma, { recurringOn: false })
      await login(page, SEED.client.email, SEED.client.password)

      const res = await page.request.post(`/api/my/memberships/${RECURRING_ID}/buy`, {
        data: { consent: true },
      })
      expect(res.status()).toBe(409)
      expect((await res.json()).error).toContain('set it up')
      expect(await prisma.membershipPurchase.count({ where: { membershipId: RECURRING_ID } })).toBe(0)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('cross-tenant: a client cannot subscribe to another business’s plan', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await seedRecurring(prisma)
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: 'Rival Dog Co' }, select: { id: true },
      })
      const rivalMembership = await prisma.membership.create({
        data: {
          trainerId: rival!.id, name: 'Rival Ongoing', priceCents: 5000,
          cadence: 'RECURRING', interval: 'MONTH', published: true,
          plans: { create: [{ interval: 'MONTH', priceCents: 5000, order: 0 }] },
        },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post(`/api/my/memberships/${rivalMembership.id}/buy`, {
        data: { consent: true },
      })

      // 404, not 403 — a 403 would confirm the rival's plan exists.
      expect(res.status()).toBe(404)
      expect(await prisma.membershipPurchase.count({ where: { membershipId: rivalMembership.id } })).toBe(0)

      await prisma.membership.delete({ where: { id: rivalMembership.id } })
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('the consent screen states price, term and fee before anything is charged', async ({ page }) => {
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    try {
      await seedRecurring(prisma)
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-memberships')

      await page.getByRole('button', { name: /Subscribe/ }).click()

      const dialog = page.getByRole('dialog', { name: /Confirm E2E Ongoing Plan/ })
      await expect(dialog).toBeVisible()
      // Everything a client needs before handing over a card.
      await expect(dialog).toContainText('$400.00 every month')
      await expect(dialog).toContainText("You're committing to 3 months.")
      await expect(dialog).toContainText('$50.00 early-finish fee')
      await expect(dialog).toContainText('You can cancel any time from Packages in this app.')
      // The trainer is named as the party charging — not PupManager.
      await expect(dialog).toContainText('I agree E2E Dog School can charge my card $400.00 every month until I cancel.')

      // The confirm button stays disabled until the box is actually ticked.
      const confirm = dialog.getByRole('button', { name: /Agree & continue/ })
      await expect(confirm).toBeDisabled()
      await dialog.getByRole('checkbox').check()
      await expect(confirm).toBeEnabled()

      // Choosing a different billing option rewrites the agreement AND clears
      // the tick — a tick made against the monthly plan cannot carry over to
      // the weekly one.
      await dialog.getByRole('radio', { name: /\$120\.00 \/ week/ }).check()
      await expect(dialog).toContainText('$120.00 every week')
      await expect(dialog).toContainText('Cancel any time.')
      await expect(confirm).toBeDisabled()
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })
})

test.describe('recurring memberships — cancelling', () => {
  /** An already-running subscription for the seeded client. */
  async function seedLiveSubscription(prisma: Awaited<ReturnType<typeof makePrisma>>, trainerId: string) {
    const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
    await prisma.membershipPurchase.create({
      data: {
        id: PURCHASE_ID,
        membershipId: RECURRING_ID,
        trainerId,
        clientId: SEED.assignedClientId,
        planId: PLAN_ID,
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_e2e_live',
        stripeCustomerId: 'cus_e2e',
        currentPeriodEnd: periodEnd,
        committedUntil: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000),
        sandbox: true,
      },
    })
    return periodEnd
  }

  test('a client sees the plan they are paying for and can reach the cancel screen', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainerId = await seedRecurring(prisma)
      await seedLiveSubscription(prisma, trainerId)

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-memberships')

      // "Your plans" is NOT behind the storefront kill-switch — see the note at
      // the top of this file.
      await expect(page.getByText('Your plans')).toBeVisible()
      // Named in both the plans list and the storefront card below it.
      await expect(page.getByText('E2E Ongoing Plan').first()).toBeVisible()
      // Priced in both the plans list and the storefront card below it.
      await expect(page.getByText('$400.00 / month').first()).toBeVisible()

      await page.getByRole('button', { name: 'Cancel', exact: true }).click()

      const dialog = page.getByRole('dialog', { name: /Cancel E2E Ongoing Plan/ })
      await expect(dialog).toBeVisible()
      // It must say WHEN it stops, as a date, and that they keep it until then.
      await expect(dialog).toContainText("You'll keep your plan until")
      await expect(dialog).toContainText("it won't renew and you won't be charged again")
      // Inside a minimum term, the fee is stated BEFORE they confirm — and it is
      // honest that Phase 1 does not charge it automatically.
      await expect(dialog).toContainText('You committed to this until')
      await expect(dialog).toContainText("we won't charge it automatically")
      // One screen, and a way back out. No retention chain.
      await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeVisible()
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('cross-tenant: a client cannot cancel someone else’s subscription', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainerId = await seedRecurring(prisma)
      // A subscription belonging to a DIFFERENT client of the same trainer.
      await prisma.membershipPurchase.create({
        data: {
          id: RIVAL_PURCHASE_ID,
          membershipId: RECURRING_ID,
          trainerId,
          clientId: SEED.unassignedClientId,
          planId: PLAN_ID,
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_e2e_other',
          currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          sandbox: true,
        },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post(`/api/my/memberships/purchases/${RIVAL_PURCHASE_ID}/cancel`, { data: {} })

      // 404 — the lookup is scoped to the caller's own clientId, so another
      // client's purchase id simply resolves to nothing.
      expect(res.status()).toBe(404)

      // And it is untouched: never cancelled, never even flagged.
      const after = await prisma.membershipPurchase.findUnique({ where: { id: RIVAL_PURCHASE_ID } })
      expect(after?.status).toBe('ACTIVE')
      expect(after?.cancelAtPeriodEnd).toBe(false)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })

  test('cancelling a purchase that is not a subscription is refused', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainerId = await seedRecurring(prisma)
      await prisma.membershipPurchase.create({
        data: {
          id: PURCHASE_ID,
          membershipId: RECURRING_ID,
          trainerId,
          clientId: SEED.assignedClientId,
          status: 'ACTIVE',
          // No stripeSubscriptionId — a one-off grant has nothing to stop.
          sandbox: true,
        },
      })

      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post(`/api/my/memberships/purchases/${PURCHASE_ID}/cancel`, { data: {} })
      expect(res.status()).toBe(409)
    } finally {
      await cleanup(prisma)
      await prisma.$disconnect()
    }
  })
})
