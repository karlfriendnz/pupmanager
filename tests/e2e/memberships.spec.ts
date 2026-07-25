import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Memberships — a trainer bundles offerings into one buyable package.
// Covers the builder UI, the recurring pricing options (per week/fortnight/
// month), the cross-tenant guards on the CRUD routes, and what a client can
// actually see in the Offerings flow. Buying hands off to Stripe, so the client
// half stops at the buy button (fulfilment has unit coverage in
// membership-fulfilment.test.ts).

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

// Desktop: the builder is a two-column layout (form + live preview).
test.use({ viewport: { width: 1280, height: 900 } })

test.describe('memberships — trainer builds, client sees', () => {
  test('owner builds a one-off membership in the UI and it lands in the list', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Built Bundle ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/memberships')

      // The way in is the dashed button that closes the list (or the empty
      // state's, when there are none) — there's no control-bar action.
      await page.getByRole('main').getByRole('button', { name: 'New membership' }).first().click()
      await page.getByPlaceholder('Membership name (e.g. Puppy Starter)').fill(name)
      await page.getByPlaceholder('Price').fill('89')

      // One included offering: the seeded self-book package, ×2.
      await page.getByRole('button', { name: 'Add item' }).click()
      const row = page.locator('select').filter({ hasText: 'Choose…' }).first()
      await row.selectOption({ label: 'Self-Book Session' })

      await page.getByLabel('Published').click()
      await page.getByRole('button', { name: 'Save' }).click()

      // It shows in the list, and persisted as a published one-off.
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      const saved = await prisma.membership.findFirst({ where: { name }, include: { items: true } })
      expect(saved?.published).toBe(true)
      expect(saved?.cadence).toBe('ONE_OFF')
      expect(saved?.priceCents).toBe(8900)
      expect(saved?.items).toHaveLength(1)
      expect(saved?.items[0].packageId).toBe(SEED.selfBookPackageId)
    } finally {
      await prisma.membership.deleteMany({ where: { name } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a recurring membership carries several billing options, and PATCH replaces them', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/trainer/memberships', {
        data: {
          name: 'E2E Recurring Bundle', priceCents: 0, cadence: 'RECURRING', published: true,
          plans: [
            { interval: 'WEEK', priceCents: 2500, minTermCount: 12, earlyTermFeeCents: 5000 },
            { interval: 'FORTNIGHT', priceCents: 4800 },
            { interval: 'MONTH', priceCents: 9000, minTermCount: 3 },
          ],
          items: [{ kind: 'PACKAGE', packageId: SEED.selfBookPackageId, quantity: 1 }],
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      id = (await res.json()).id

      const plans = await prisma.membershipPlan.findMany({ where: { membershipId: id! }, orderBy: { order: 'asc' } })
      expect(plans.map(p => [p.interval, p.priceCents])).toEqual([['WEEK', 2500], ['FORTNIGHT', 4800], ['MONTH', 9000]])
      expect(plans[0].minTermCount).toBe(12)
      expect(plans[0].earlyTermFeeCents).toBe(5000)
      // An option with no minimum term is cancel-any-time, not null.
      expect(plans[1].minTermCount).toBe(0)

      // PATCH replaces the whole set rather than appending to it.
      const patch = await page.request.patch(`/api/trainer/memberships/${id}`, {
        data: { plans: [{ interval: 'MONTH', priceCents: 7500 }] },
      })
      expect(patch.status(), await patch.text()).toBe(200)
      const after = await prisma.membershipPlan.findMany({ where: { membershipId: id! } })
      expect(after.map(p => [p.interval, p.priceCents])).toEqual([['MONTH', 7500]])
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a client only sees published one-off memberships, and only their own trainer’s', async ({ page }) => {
    const prisma = await makePrisma()
    const made: string[] = []
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })

      // Three that must NOT reach the client, for three different reasons.
      for (const data of [
        { trainerId: trainer!.id, name: 'E2E Draft Bundle', priceCents: 5000, published: false },
        { trainerId: trainer!.id, name: 'E2E Subscription Bundle', priceCents: 0, published: true, cadence: 'RECURRING' as const },
        { trainerId: rival!.id, name: 'E2E Rival Bundle', priceCents: 5000, published: true },
      ]) {
        made.push((await prisma.membership.create({ data })).id)
      }

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /Memberships/ }).click()

      // The seeded published one-off is there…
      await expect(page.getByRole('heading', { name: SEED.membershipName })).toBeVisible({ timeout: 15_000 })
      // …and none of the three others are.
      await expect(page.getByText('E2E Draft Bundle')).toHaveCount(0)
      await expect(page.getByText('E2E Subscription Bundle')).toHaveCount(0)
      await expect(page.getByText('E2E Rival Bundle')).toHaveCount(0)
    } finally {
      await prisma.membership.deleteMany({ where: { id: { in: made } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('Business B cannot read, edit or delete Business A’s membership', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      id = (await prisma.membership.create({
        data: { trainerId: trainer!.id, name: 'E2E Tenant Target', priceCents: 5000, published: true },
      })).id

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

      expect((await page.request.get(`/api/trainer/memberships/${id}`)).status()).toBe(404)
      expect((await page.request.patch(`/api/trainer/memberships/${id}`, { data: { name: 'Stolen' } })).status()).toBe(404)
      expect((await page.request.delete(`/api/trainer/memberships/${id}`)).status()).toBe(404)

      // Still Business A's, untouched.
      const after = await prisma.membership.findUnique({ where: { id: id! }, select: { name: true, trainerId: true } })
      expect(after?.name).toBe('E2E Tenant Target')
      expect(after?.trainerId).toBe(trainer!.id)

      // Give B the add-on, so what's proven below is the OWNERSHIP check and not
      // just the add-on gate refusing them first.
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })
      await prisma.trainerAddon.upsert({
        where: { trainerId_itemId: { trainerId: rival!.id, itemId: 'memberships' } },
        create: { trainerId: rival!.id, itemId: 'memberships', active: true },
        update: { active: true },
      })

      // Nor can B bundle A's package into a membership of its own.
      const steal = await page.request.post('/api/trainer/memberships', {
        data: {
          name: 'E2E Cross-tenant Bundle', priceCents: 1000,
          items: [{ kind: 'PACKAGE', packageId: SEED.selfBookPackageId, quantity: 1 }],
        },
      })
      expect(steal.status()).toBe(404)
      expect(await prisma.membership.count({ where: { name: 'E2E Cross-tenant Bundle' } })).toBe(0)
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // Memberships have no timetable, so their reminders anchor on the client's
  // purchase: "when they join", "7 days before it renews".
  test('a membership carries its own reminders, anchored on the purchase', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const created = await page.request.post('/api/trainer/memberships', {
        data: { name: 'E2E Reminder Bundle', priceCents: 6000, published: true, items: [] },
      })
      expect(created.status(), await created.text()).toBe(201)
      id = (await created.json()).id

      // The starter flow is purchase-anchored, not session-anchored.
      const seeded = await page.request.post(`/api/trainer/memberships/${id}/comms-flow`, { data: { seed: 'starter' } })
      expect(seeded.status(), await seeded.text()).toBe(201)
      const steps = await prisma.commsFlowStep.findMany({ where: { membershipId: id! }, orderBy: { order: 'asc' } })
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.every(s => s.direction === 'AFTER_PURCHASE')).toBe(true)
      expect(steps[0].offsetMinutes).toBe(0) // a welcome, the moment they join

      // A renewal reminder counts back from the period end.
      const renewal = await page.request.post(`/api/trainer/memberships/${id}/comms-flow`, {
        data: {
          direction: 'BEFORE_PERIOD_END', offsetMinutes: 4320, channels: ['EMAIL'],
          title: 'Renewing soon', body: 'Your {{membership}} renews in 3 days.', enabled: true,
        },
      })
      expect(renewal.status(), await renewal.text()).toBe(201)
      const step = await prisma.commsFlowStep.findFirst({ where: { membershipId: id!, direction: 'BEFORE_PERIOD_END' } })
      expect(step?.offsetMinutes).toBe(4320)

      // Editing and deleting go through the same guarded tree.
      const patched = await page.request.patch(`/api/trainer/memberships/${id}/comms-flow/${step!.id}`, {
        data: { title: 'Renewing in 3 days' },
      })
      expect(patched.status()).toBe(200)
      const del = await page.request.delete(`/api/trainer/memberships/${id}/comms-flow/${step!.id}`)
      expect(del.status()).toBe(200)
      expect(await prisma.commsFlowStep.count({ where: { id: step!.id } })).toBe(0)
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('Business B cannot read or add reminders on Business A’s membership', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      id = (await prisma.membership.create({
        data: { trainerId: trainer!.id, name: 'E2E Reminder Target', priceCents: 5000, published: true },
      })).id

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

      expect((await page.request.get(`/api/trainer/memberships/${id}/comms-flow`)).status()).toBe(404)
      const post = await page.request.post(`/api/trainer/memberships/${id}/comms-flow`, {
        data: { title: 'Sneaky', body: 'Hello', channels: ['PUSH'], enabled: true },
      })
      expect(post.status()).toBe(404)
      expect(await prisma.commsFlowStep.count({ where: { membershipId: id! } })).toBe(0)
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
