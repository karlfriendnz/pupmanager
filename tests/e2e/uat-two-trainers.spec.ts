import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// ACC-1 for real: one dog owner, two trainers. A live customer has this, so it
// needs to be more than "the rows exist" — the question is whether switching
// keeps the two worlds apart.
//
// How it works (researched before writing): /switch-trainer lists the person's
// profiles, /switch-trainer/[clientId] verifies the profile is theirs and pins
// it in the httpOnly `pm-active-trainer` cookie, and getActiveClient() reads
// that cookie scoped to the signed-in user — falling back to the most recent
// relationship when it's missing or doesn't belong to them.
//
// The risk isn't the switch. It's leakage: seeing trainer A's things while
// standing in trainer B's space.

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

async function dismissAppPrompt(page: Page) {
  const later = page.getByRole('button', { name: 'Maybe later' })
  if (await later.isVisible().catch(() => false)) await later.click()
}

/**
 * Get to the 1-on-1 list on /my-availability, whichever shape the wizard is in.
 *
 * Step 1 is normally a menu of offering TYPES, so you tap "1-on-1 sessions" to
 * drill in. But a trainer who sells only ONE kind of thing has a single way in,
 * and the wizard opens that list directly with no row to tap (`onlyWayIn` in
 * booking-wizard.tsx). Trainer B here sells exactly one package; trainer A sells
 * several kinds — so both shapes turn up in the same test.
 *
 * The type row is renameable (`labelFor('/packages', …)`), so match its default
 * loosely and settle on the list heading, which reads the same either way.
 */
async function openOneToOneList(page: Page) {
  const typeRow = page.getByRole('button', { name: /1-on-1 sessions/ })
  const listHeading = page.getByRole('heading', { name: '1-on-1 sessions' })
  await expect(typeRow.or(listHeading).first()).toBeVisible({ timeout: 20_000 })
  if (await typeRow.isVisible().catch(() => false)) await typeRow.click()
  await expect(listHeading).toBeVisible({ timeout: 15_000 })
}

/**
 * Taking on a second trainer means that trainer's intake gate — reasonably,
 * since each trainer keeps their own record of you. Clear it so the tests can
 * reach the app behind it.
 */
async function clearIntakeGate(page: Page) {
  const save = page.getByRole('button', { name: 'Save and continue' })
  if (!(await save.isVisible().catch(() => false))) return
  const phone = page.getByPlaceholder(/can reach you/)
  if (await phone.isVisible().catch(() => false)) {
    if (!(await phone.inputValue())) await phone.fill('021 555 0199')
  }
  await save.click()
  await expect(save).toBeHidden({ timeout: 20_000 })
}

/** Everything the second relationship needs, torn down again afterwards. */
async function setUpSecondTrainer(prisma: Awaited<ReturnType<typeof makePrisma>>) {
  const clientUser = await prisma.user.findUnique({
    where: { email: SEED.client.email }, select: { id: true },
  })
  const businessB = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.businessB.businessName }, select: { id: true },
  })

  const stamp = Date.now()
  // A self-bookable package on B, so the two Offerings lists are tellable apart.
  const bPackage = await prisma.package.create({
    data: {
      trainerId: businessB!.id,
      name: `E2E B-Only Package ${stamp}`,
      sessionCount: 1, weeksBetween: 1, durationMins: 60,
      clientSelfBook: true, selfBookRequiresApproval: false,
    },
  })
  const bProfile = await prisma.clientProfile.create({
    data: { userId: clientUser!.id, trainerId: businessB!.id, status: 'ACTIVE' },
  })

  return {
    clientUserId: clientUser!.id,
    bTrainerId: businessB!.id,
    bProfileId: bProfile.id,
    bPackageName: bPackage.name,
    bPackageId: bPackage.id,
    async cleanup() {
      await prisma.clientProfile.delete({ where: { id: bProfile.id } }).catch(() => {})
      await prisma.package.delete({ where: { id: bPackage.id } }).catch(() => {})
    },
  }
}

test.describe('UAT — one dog owner, two trainers', () => {
  test('ACC-1 · the switcher appears, and switching changes whose space you are in', async ({ page }) => {
    const prisma = await makePrisma()
    const ctx = await setUpSecondTrainer(prisma)
    try {
      await login(page, SEED.client.email, SEED.client.password)

      // Both relationships are offered, named by business.
      await page.goto('/switch-trainer')
      await dismissAppPrompt(page)
      await expect(page.getByText(SEED.owner.businessName).locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(SEED.businessB.businessName).locator('visible=true').first()).toBeVisible()

      // Switch to the second trainer.
      await page.goto(`/switch-trainer/${ctx.bProfileId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await clearIntakeGate(page)
      await dismissAppPrompt(page)

      // The whole app is now the second trainer's.
      await expect(page.getByText(SEED.businessB.businessName).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // And the choice sticks as they move around — it's a cookie, not a query param.
      await page.goto('/my-sessions')
      await expect(page.getByText(SEED.businessB.businessName).locator('visible=true').first()).toBeVisible()
    } finally {
      await ctx.cleanup()
      await prisma.$disconnect()
    }
  })

  // The one that matters: no bleed between the two trainers.
  test('ACC-1 · each trainer’s offerings stay with that trainer', async ({ page }) => {
    const prisma = await makePrisma()
    const ctx = await setUpSecondTrainer(prisma)
    try {
      await login(page, SEED.client.email, SEED.client.password)

      // Standing in trainer B's space: B's package, and NOT A's.
      await page.goto(`/switch-trainer/${ctx.bProfileId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await clearIntakeGate(page)
      await page.goto('/my-availability')
      await dismissAppPrompt(page)
      await openOneToOneList(page)

      await expect(page.getByText(ctx.bPackageName).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText('Self-Book Session'),
        "trainer A's package must not be on offer inside trainer B's space",
      ).toHaveCount(0)

      // Switch back: A's package returns, B's goes away.
      const aProfileId = SEED.assignedClientId
      await page.goto(`/switch-trainer/${aProfileId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await page.goto('/my-availability')
      await dismissAppPrompt(page)
      await openOneToOneList(page)

      await expect(page.getByText('Self-Book Session').locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText(ctx.bPackageName),
        "trainer B's package must not follow them back to trainer A",
      ).toHaveCount(0)
    } finally {
      await ctx.cleanup()
      await prisma.$disconnect()
    }
  })

  test('ACC-1 · sessions booked with one trainer do not show under the other', async ({ page }) => {
    const prisma = await makePrisma()
    const ctx = await setUpSecondTrainer(prisma)
    const title = `E2E A-Only Session ${Date.now()}`
    let sessionId: string | null = null
    try {
      const aTrainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      // A session that belongs to trainer A's relationship only.
      sessionId = (await prisma.trainingSession.create({
        data: {
          trainerId: aTrainer!.id,
          clientId: SEED.assignedClientId,
          scheduledAt: new Date(Date.now() + 3 * 864e5),
          durationMins: 60,
          title,
        },
      })).id

      await login(page, SEED.client.email, SEED.client.password)

      // Under trainer A: it's theirs.
      await page.goto(`/switch-trainer/${SEED.assignedClientId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await page.goto('/my-sessions')
      await dismissAppPrompt(page)
      await expect(page.getByText(title).locator('visible=true').first()).toBeVisible({ timeout: 15_000 })

      // Under trainer B: it is not.
      await page.goto(`/switch-trainer/${ctx.bProfileId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await clearIntakeGate(page)
      await page.goto('/my-sessions')
      await dismissAppPrompt(page)
      await expect(
        page.getByText(title),
        "a session with one trainer must not appear in another trainer's space",
      ).toHaveCount(0)
    } finally {
      if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
      await ctx.cleanup()
      await prisma.$disconnect()
    }
  })

  // Switching is a URL anyone can type. It must only ever switch to something
  // that is actually theirs.
  test('ACC-1 · you cannot switch into someone else’s client record', async ({ page }) => {
    const prisma = await makePrisma()
    const ctx = await setUpSecondTrainer(prisma)
    try {
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto(`/switch-trainer/${SEED.assignedClientId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })

      // Another household entirely — Business B's own client.
      await page.goto(`/switch-trainer/${SEED.businessB.clientId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })
      await dismissAppPrompt(page)

      // Bounced home, still standing in their own trainer's space.
      await expect(page.getByText(SEED.owner.businessName).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText(SEED.businessB.name),
        'the other household’s name must not appear anywhere',
      ).toHaveCount(0)
    } finally {
      await ctx.cleanup()
      await prisma.$disconnect()
    }
  })

  // The fix for what this walkthrough turned up: a second trainer used to mean
  // a blank phone box, even though the platform already had the number.
  test('ACC-1 · a second trainer’s intake offers the phone we already hold', async ({ page }) => {
    const prisma = await makePrisma()
    const ctx = await setUpSecondTrainer(prisma)
    try {
      // Their first trainer already has a number on file.
      await prisma.clientProfile.update({
        where: { id: SEED.assignedClientId }, data: { phone: '021 555 0123' },
      })

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto(`/switch-trainer/${ctx.bProfileId}`)
      await page.waitForURL(/\/home/, { timeout: 20_000 })

      // The new trainer's gate opens with it filled in, ready to confirm or change.
      await expect(page.getByRole('heading', { name: 'Before you get started' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(page.getByPlaceholder(/can reach you/))
        .toHaveValue('021 555 0123')

      // Suggested, not silently copied: this trainer's own record is still empty
      // until the client submits it.
      const bProfile = await prisma.clientProfile.findUnique({
        where: { id: ctx.bProfileId }, select: { phone: true },
      })
      expect(bProfile?.phone, 'the number must not be written to the new trainer behind their back').toBeNull()
    } finally {
      await ctx.cleanup()
      await prisma.$disconnect()
    }
  })
})
