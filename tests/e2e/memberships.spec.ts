import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '../../src/lib/feature-flags'

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
      await page.getByRole('main').getByRole('button', { name: 'New package' }).first().click()
      await page.getByPlaceholder('Package name (e.g. Puppy Starter)').fill(name)
      await page.getByPlaceholder('Price').fill('89')

      // One included offering: the seeded self-book package, ×2.
      await page.getByRole('tab', { name: 'Included' }).click()
      await page.getByRole('button', { name: 'Add item' }).click()
      const row = page.locator('select').filter({ hasText: 'Choose…' }).first()
      await row.selectOption({ label: 'Self-Book Session' })

      // Published sits with the package's other facts on Details.
      await page.getByRole('tab', { name: 'Details' }).click()
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
      // Sent without a count, every one of these means ONE cycle — exactly what
      // it meant before the column existed. FORTNIGHT is untouched.
      expect(plans.map(p => p.intervalCount)).toEqual([1, 1, 1])

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

  test('“6 week grooming” — a cycle of 6 weeks saves, survives a reload, and refuses nonsense', async ({ page }) => {
    // The round trip against a real database. A field the trainer typed is only
    // proven to have persisted by save → reload → assert, and this is the
    // single most repeated bug in this codebase.
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/trainer/memberships', {
        data: {
          name: 'E2E 6 Week Grooming', priceCents: 0, cadence: 'RECURRING', published: true,
          plans: [{ interval: 'WEEK', intervalCount: 6, priceCents: 6000, minTermCount: 2 }],
          items: [],
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      id = (await res.json()).id

      // It is in the DATABASE as six weeks, not as a week and not as a month.
      const stored = await prisma.membershipPlan.findFirst({ where: { membershipId: id! } })
      expect([stored?.interval, stored?.intervalCount, stored?.priceCents]).toEqual(['WEEK', 6, 6000])

      // …and it comes back out of the editor's own GET as six weeks.
      const reload = await page.request.get(`/api/trainer/memberships/${id}`)
      expect(reload.status()).toBe(200)
      const body = await reload.json()
      expect(body.plans).toHaveLength(1)
      expect(body.plans[0].interval).toBe('WEEK')
      expect(body.plans[0].intervalCount).toBe(6)

      // Editing to 8 weeks round-trips too, and the plan row it writes carries
      // no Stripe ids — so the next sale mints a NEW immutable Price.
      const patch = await page.request.patch(`/api/trainer/memberships/${id}`, {
        data: { plans: [{ interval: 'WEEK', intervalCount: 8, priceCents: 6000 }] },
      })
      expect(patch.status(), await patch.text()).toBe(200)
      const edited = await prisma.membershipPlan.findFirst({ where: { membershipId: id! } })
      expect(edited?.intervalCount).toBe(8)
      expect(edited?.stripePriceId).toBeNull()
      expect(edited?.stripeProductId).toBeNull()

      // The bounds are the SERVER's, not the number input's. A request straight
      // at the route with 0 and with 500 is refused, and nothing is written.
      for (const bad of [0, -6, 500]) {
        const refused = await page.request.patch(`/api/trainer/memberships/${id}`, {
          data: { plans: [{ interval: 'WEEK', intervalCount: bad, priceCents: 6000 }] },
        })
        expect(refused.status(), `intervalCount ${bad} must be refused`).toBe(400)
      }
      const untouched = await prisma.membershipPlan.findFirst({ where: { membershipId: id! } })
      expect(untouched?.intervalCount).toBe(8)
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a client sees their trainer’s published memberships — never a draft, never a rival’s', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    const made: string[] = []
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })

      // Two that must NOT reach the client, plus a published RECURRING one that
      // now MUST (it used to be filtered out, which meant a trainer whose only
      // published package was recurring showed their clients nothing at all).
      for (const data of [
        { trainerId: trainer!.id, name: 'E2E Draft Bundle', priceCents: 5000, published: false },
        { trainerId: trainer!.id, name: 'E2E Subscription Bundle', priceCents: 4000, published: true, cadence: 'RECURRING' as const, interval: 'MONTH' as const },
        { trainerId: rival!.id, name: 'E2E Rival Bundle', priceCents: 5000, published: true },
      ]) {
        made.push((await prisma.membership.create({ data })).id)
      }

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /Packages/ }).click()

      // The seeded published one-off is there, buyable…
      await expect(page.getByRole('heading', { name: SEED.membershipName })).toBeVisible({ timeout: 15_000 })
      // …the recurring one is there too, priced per period and NOT buyable —
      // it offers a request instead of a checkout button that would 409.
      // The CARD, not the innermost div holding the title — the price and the
      // button are siblings of that, so .last() could never contain them.
      const recurring = page.getByTestId('membership-card')
        .filter({ has: page.getByRole('heading', { name: 'E2E Subscription Bundle' }) })
      await expect(recurring).toContainText('/ month')
      await expect(recurring.getByRole('button', { name: 'Request this' })).toBeVisible()
      // …and neither of the other two is anywhere.
      await expect(page.getByText('E2E Draft Bundle')).toHaveCount(0)
      await expect(page.getByText('E2E Rival Bundle')).toHaveCount(0)
    } finally {
      await prisma.membershipRequest.deleteMany({ where: { membershipId: { in: made } } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { id: { in: made } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a client can request a package they can’t check out, and it sticks', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      id = (await prisma.membership.create({
        data: {
          trainerId: trainer!.id, name: 'E2E Ongoing Plan', priceCents: 4000,
          published: true, cadence: 'RECURRING', interval: 'MONTH',
        },
      })).id

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-memberships')

      const card = page.getByTestId('membership-card')
        .filter({ has: page.getByRole('heading', { name: 'E2E Ongoing Plan' }) })
      // The reason is still stated — the button is an action beside it, not a
      // replacement for the explanation.
      await expect(card).toContainText('bills you regularly')
      await card.getByRole('button', { name: 'Request this' }).click()
      await expect(card.getByText('Requested')).toBeVisible({ timeout: 15_000 })

      // Persisted, with the reason recorded so the trainer knows which job it is.
      const rows = await prisma.membershipRequest.findMany({ where: { membershipId: id! } })
      expect(rows).toHaveLength(1)
      expect(rows[0].reason).toBe('RECURRING')
      expect(rows[0].status).toBe('PENDING')

      // Survives a reload — not a state flip that forgets.
      await page.reload()
      const after = page.getByTestId('membership-card')
        .filter({ has: page.getByRole('heading', { name: 'E2E Ongoing Plan' }) })
      await expect(after.getByText('Requested')).toBeVisible({ timeout: 15_000 })
      await expect(after.getByRole('button', { name: 'Request this' })).toHaveCount(0)

      // A second POST is a no-op — one row, so the trainer is told once.
      const again = await page.request.post(`/api/my/memberships/${id}/request`)
      expect(again.status()).toBe(200)
      expect(await prisma.membershipRequest.count({ where: { membershipId: id! } })).toBe(1)
    } finally {
      if (id) {
        await prisma.membershipRequest.deleteMany({ where: { membershipId: id } }).catch(() => {})
        await prisma.membership.delete({ where: { id } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // ─── The trainer's half of "Request this" ──────────────────────────────────
  // A request the trainer never sees is a lead lost, so the pending rows land on
  // the dashboard next to the shop's product requests. These packages carry NO
  // included items on purpose: the grant itself has unit coverage, and handing
  // the shared seed client a ClientPackage + sessions would shift counts other
  // specs assert on.

  async function seedRequest(prisma: Awaited<ReturnType<typeof makePrisma>>, name: string) {
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName }, select: { id: true },
    })
    const membership = await prisma.membership.create({
      data: {
        trainerId: trainer!.id, name, priceCents: 4000,
        published: true, cadence: 'RECURRING', interval: 'MONTH',
      },
    })
    const request = await prisma.membershipRequest.create({
      data: { clientId: SEED.assignedClientId, membershipId: membership.id, reason: 'RECURRING', status: 'PENDING' },
    })
    return { membershipId: membership.id, requestId: request.id }
  }

  async function cleanupRequest(prisma: Awaited<ReturnType<typeof makePrisma>>, membershipId: string) {
    await prisma.membershipRequest.deleteMany({ where: { membershipId } }).catch(() => {})
    await prisma.membershipPurchase.deleteMany({ where: { membershipId } }).catch(() => {})
    await prisma.membership.delete({ where: { id: membershipId } }).catch(() => {})
  }

  test('the trainer meets the request on the dashboard and accepting takes no money', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    const name = `E2E Requested Plan ${Date.now()}`
    let membershipId: string | null = null
    try {
      ;({ membershipId } = await seedRequest(prisma, name))

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/dashboard')

      // It's on the screen the trainer opens every morning, saying who and what.
      // The request ROW — the one that holds both the name and its buttons.
      // The dashboard renders this panel twice — a mobile copy and a desktop
      // one — so the row exists in both. Take the one on screen.
      const row = page.getByTestId('request-row')
        .filter({ hasText: name })
        .filter({ visible: true })
        .first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      // At least one, not exactly one: another spec's pending request may be
      // sitting in this list, and the count is not what this test is about.
      // Same twice-rendered panel — the first copy is the hidden one.
      await expect(page.getByText(/\d+ requests? from clients/).filter({ visible: true }).first()).toBeVisible()
      await expect(row).toContainText('Ongoing plan')

      // Accept THIS request, not whichever is top of the list — another spec's
      // pending request sitting above it would otherwise be the one accepted,
      // and this one would still be on screen at the assertion below. That is
      // exactly how this failed in the full suite while passing on its own.
      await row.getByRole('button', { name: 'Accept' }).first().click()

      // Accepting is now TWO decisions — charge them, or hand it over and
      // invoice. This trainer has no connected Stripe account, so the paid
      // choice is not offered at all (AGENTS.md #6: the server decides that from
      // the real capability, never the browser).
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByTestId('request-charge')).toHaveCount(0)

      // The money promise is kept on the choice it belongs to: this one grants
      // the package and takes nothing, and must say so before it is tapped.
      const grant = dialog.getByTestId('request-grant')
      await expect(grant).toContainText('No payment is taken')
      await expect(grant).toContainText(/invoice/i)
      await grant.click()

      // The REQUEST is gone — not every mention of the package name. Once it is
      // accepted the client is on it, so the name legitimately turns up
      // elsewhere on the dashboard; what must disappear is the row asking the
      // trainer to decide.
      await expect(page.getByTestId('request-row').filter({ hasText: name }))
        .toHaveCount(0, { timeout: 20_000 })

      // The client is on the package via the SAME purchase record a paid
      // checkout writes — but with no payment attached, because none was taken.
      const req = await prisma.membershipRequest.findFirst({ where: { membershipId: membershipId! } })
      expect(req?.status).toBe('FULFILLED')
      expect(req?.fulfilledAt).not.toBeNull()

      const purchases = await prisma.membershipPurchase.findMany({ where: { membershipId: membershipId! } })
      expect(purchases).toHaveLength(1)
      expect(purchases[0].clientId).toBe(SEED.assignedClientId)
      expect(purchases[0].paymentId).toBeNull()
    } finally {
      if (membershipId) await cleanupRequest(prisma, membershipId)
      await prisma.$disconnect()
    }
  })

  test('declining closes the request without granting anything', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Declined Plan ${Date.now()}`
    let membershipId: string | null = null
    let requestId: string | null = null
    try {
      ;({ membershipId, requestId } = await seedRequest(prisma, name))

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.patch(`/api/membership-requests/${requestId}`, {
        data: { status: 'DECLINED' },
      })
      expect(res.status()).toBe(200)

      const req = await prisma.membershipRequest.findFirst({ where: { id: requestId! } })
      expect(req?.status).toBe('DECLINED')
      // Nothing granted — a decline is not a quiet accept.
      expect(await prisma.membershipPurchase.count({ where: { membershipId: membershipId! } })).toBe(0)
    } finally {
      if (membershipId) await cleanupRequest(prisma, membershipId)
      await prisma.$disconnect()
    }
  })

  test('the trainer’s Packages list counts who is waiting', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Waiting Plan ${Date.now()}`
    let membershipId: string | null = null
    try {
      ;({ membershipId } = await seedRequest(prisma, name))

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/memberships')

      const card = page.locator('div').filter({ hasText: name }).last()
      await expect(card).toContainText('1 waiting', { timeout: 20_000 })
    } finally {
      if (membershipId) await cleanupRequest(prisma, membershipId)
      await prisma.$disconnect()
    }
  })

  test('Business B cannot see or action Business A’s membership request', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Guarded Plan ${Date.now()}`
    let membershipId: string | null = null
    let requestId: string | null = null
    try {
      ;({ membershipId, requestId } = await seedRequest(prisma, name))

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

      // 404, not 403 — a foreign id must not even confirm the row exists.
      for (const status of ['FULFILLED', 'DECLINED']) {
        const res = await page.request.patch(`/api/membership-requests/${requestId}`, { data: { status } })
        expect(res.status()).toBe(404)
      }

      // Untouched, and nothing granted on A's tenant.
      const req = await prisma.membershipRequest.findFirst({ where: { id: requestId! } })
      expect(req?.status).toBe('PENDING')
      expect(await prisma.membershipPurchase.count({ where: { membershipId: membershipId! } })).toBe(0)

      // And B's own dashboard never lists it.
      await page.goto('/dashboard')
      await expect(page.getByText(name)).toHaveCount(0)
    } finally {
      if (membershipId) await cleanupRequest(prisma, membershipId)
      await prisma.$disconnect()
    }
  })

  test('a buyable package refuses a request — Request is not a way to skip paying', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await login(page, SEED.client.email, SEED.client.password)
      const res = await page.request.post(`/api/my/memberships/${SEED.membershipId}/request`)
      expect(res.status()).toBe(409)
      expect(await prisma.membershipRequest.count({ where: { membershipId: SEED.membershipId } })).toBe(0)
    } finally {
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

  // The builder's card-appearance block and each item's description/image used
  // to hide behind toggles, and there was no way back to the list. All three are
  // now just present — these pin that so a "tidy the form" refactor can't
  // quietly re-bury them. The four tabs are the ONE thing allowed to hide a
  // panel, and none of them may re-introduce a chevron inside itself.
  test('the builder shows card appearance, per-item description/image and a way back, with nothing to expand', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/memberships')
    await page.getByRole('main').getByRole('button', { name: 'New package' }).first().click()

    // Card appearance is one tab, and everything in it is open on arrival —
    // image, button text, colours. No chevron to press.
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await expect(page.getByText('Card appearance')).toBeVisible()
    await expect(page.getByText('Colour scheme')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Card appearance' })).toHaveCount(0)

    // Button background + text colours, with a live readability read-out.
    await expect(page.getByLabel('Button background')).toBeVisible()
    await expect(page.getByLabel('Button text')).toBeVisible()
    await expect(page.getByText(/Contrast \d+(\.\d+)?:1/)).toBeVisible()

    // A new item's description editor and image control are there straight away,
    // with no "Add description & image" button to press first.
    await page.getByRole('tab', { name: 'Included' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()
    await page.getByLabel('Included offering').first().selectOption({ label: 'Self-Book Session' })
    await expect(page.getByText('Custom description').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /description & image/ })).toHaveCount(0)

    // Back returns to the list rather than stranding the trainer in the form.
    await page.getByRole('button', { name: 'Back to packages' }).click()
    await expect(page.getByRole('button', { name: 'New package' }).first()).toBeVisible()
  })

  // The screen used to be one endless column. It's tabs now, and Save belongs
  // to the package as a whole, so it stays put no matter which tab is showing —
  // it is the pinned bar's, along with Cancel and the ⋯ that holds Delete.
  test('the builder is tabs, one panel at a time, with the save bar always there', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/memberships')
    await page.getByRole('main').getByRole('button', { name: 'New package' }).first().click()

    for (const name of ['Details', 'Included', 'Appearance', 'Automation']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }

    // Details is where a new package opens, and its name field is the only
    // panel showing.
    await expect(page.getByPlaceholder('Package name (e.g. Puppy Starter)')).toBeVisible()
    await expect(page.getByText('Colour scheme')).toBeHidden()

    // Switching tabs swaps the panel — one visible at a time, never both.
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await expect(page.getByText('Colour scheme')).toBeVisible()
    await expect(page.getByPlaceholder('Package name (e.g. Puppy Starter)')).toBeHidden()

    // What's typed on one tab survives a trip to another (the panels hide, they
    // don't unmount — a remounted rich-text editor loses what's in it).
    await page.getByRole('tab', { name: 'Details' }).click()
    await page.getByPlaceholder('Package name (e.g. Puppy Starter)').fill('E2E Tab Memory')
    await page.getByRole('tab', { name: 'Automation' }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByPlaceholder('Package name (e.g. Puppy Starter)')).toHaveValue('E2E Tab Memory')

    // Save is pinned to the foot of the screen, reachable from every tab.
    await page.getByRole('tab', { name: 'Automation' }).click()
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

    // Published is a fact about the package, so it lives with the package's
    // other facts on Details rather than in a row of buttons that no longer
    // exists. It is still ONE tap from anywhere — the tab is right there.
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByLabel('Published')).toBeVisible()
  })

  // Karl struck the eye / pencil / bin off the card: the row IS the way in, and
  // the three actions live inside the package now.
  test('the list card has no icon buttons, and delete lives inside the package', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Card Actions ${Date.now()}`
    let id: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      id = (await prisma.membership.create({
        data: { trainerId: trainer!.id, name, priceCents: 5000, published: true },
      })).id

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/memberships')
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })

      // None of the three icon buttons survive on the list.
      for (const label of ['Edit', 'Delete', 'Publish', 'Unpublish']) {
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
      }

      // Opening the card is what the row does, and Delete is waiting inside it —
      // in the ⋯ , where an unrecoverable action belongs, rather than beside
      // Save where a thumb lands.
      await page.getByText(name).click()
      await expect(page.getByPlaceholder('Package name (e.g. Puppy Starter)')).toHaveValue(name)
      await page.getByRole('button', { name: /^More actions/ }).click()
      page.once('dialog', d => d.accept())
      await page.getByRole('button', { name: /Delete this package/ }).click()

      // Back on the list, and gone for good.
      await expect(page.getByRole('button', { name: 'New package' }).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(name)).toHaveCount(0)
      expect(await prisma.membership.count({ where: { id: id! } })).toBe(0)
    } finally {
      if (id) await prisma.membership.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('button colours round-trip, and an unreadable pair is corrected before a client sees it', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      // Pale yellow button with white text — saved as given…
      const created = await page.request.post('/api/trainer/memberships', {
        data: {
          name: 'E2E Button Colour Bundle', priceCents: 4200, published: true, items: [],
          buttonBgColor: '#fef08a', buttonTextColor: '#ffffff', buttonText: 'Join us',
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      id = (await created.json()).id
      const saved = await prisma.membership.findUnique({ where: { id: id! } })
      expect(saved?.buttonBgColor).toBe('#fef08a')
      expect(saved?.buttonTextColor).toBe('#ffffff')

      // …and a bad hex is refused rather than stored.
      const bad = await page.request.patch(`/api/trainer/memberships/${id}`, {
        data: { buttonBgColor: 'rebeccapurple' },
      })
      expect(bad.status()).toBe(400)

      // The client's card paints a corrected label, never the raw white.
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /Packages/ }).click()
      const buy = page.getByRole('button', { name: 'Join us' })
      await expect(buy).toBeVisible({ timeout: 15_000 })
      const colour = await buy.evaluate(el => getComputedStyle(el).color)
      expect(colour).not.toBe('rgb(255, 255, 255)')
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

// The "What's included" row used to wrap into three ragged lines on a phone,
// with the quantity box stranded above the next row's type dropdown.
test.describe('memberships builder on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('an included-item row stays two tidy lines and the page never scrolls sideways', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/memberships')
    await page.getByRole('main').getByRole('button', { name: 'New package' }).first().click()
    await page.getByRole('tab', { name: 'Included' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()

    const kind = page.getByLabel('Item type').first()
    const offering = page.getByLabel('Included offering').first()
    const qty = page.getByLabel('Quantity').first()

    const [kindBox, offeringBox, qtyBox] = await Promise.all([
      kind.boundingBox(), offering.boundingBox(), qty.boundingBox(),
    ])
    // Type + quantity share the top line; the offering picker takes the one below.
    expect(Math.abs(kindBox!.y - qtyBox!.y)).toBeLessThan(4)
    expect(offeringBox!.y).toBeGreaterThan(kindBox!.y + kindBox!.height - 4)
    // Quantity is sized for the 1–2 digits it holds, not a third of the row.
    expect(qtyBox!.width).toBeLessThan(56)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
