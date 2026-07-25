import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Something set in one place showing up in another — the thing that's easy to
// break and impossible to notice from a single screen. Admin publishes, the dog
// owner sees it. Trainer flips a setting, the dog owner sees that too.
//
// admin-announcements covers admin → TRAINER; this is the client half, which
// was never tested even though client audiences shipped in July.

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

/**
 * The client home greets a phone with a "Get the app" install modal, which sits
 * over everything until it's dismissed. Any mobile client flow has to clear it
 * first — otherwise every click below it times out looking clickable.
 */
async function dismissAppPrompt(page: Page) {
  const later = page.getByRole('button', { name: 'Maybe later' })
  if (await later.isVisible().catch(() => false)) await later.click()
}

test.describe('what an admin or trainer sets, a client sees', () => {
  test('an announcement to clients lands in the dog owner’s notifications', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    const title = `E2E Client Broadcast ${Date.now()}`
    try {
      await login(page, SEED.admin.email, SEED.admin.password)

      const created = await page.request.post('/api/admin/announcements', {
        data: { title, body: 'Something new for dog owners.', audience: 'ALL_CLIENTS' },
      })
      expect(created.status(), await created.text()).toBe(201)
      id = (await created.json()).announcement.id

      const sent = await page.request.post(`/api/admin/announcements/${id}/send`, { data: {} })
      expect(sent.status(), await sent.text()).toBe(200)

      // The seeded dog owner should now have it — and so should nobody else's
      // trainer, since this went to clients only.
      const clientUser = await prisma.user.findUnique({ where: { email: SEED.client.email }, select: { id: true } })
      const row = await prisma.notification.findFirst({
        where: { userId: clientUser!.id, title },
        select: { id: true, readAt: true },
      })
      expect(row, 'the client got no notification for an ALL_CLIENTS announcement').toBeTruthy()
      expect(row?.readAt, 'a fresh notification must arrive unread').toBeNull()

      const ownerUser = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      expect(
        await prisma.notification.count({ where: { userId: ownerUser!.id, title } }),
        'an ALL_CLIENTS announcement must not reach trainers',
      ).toBe(0)

      // And the client can actually read it in their app.
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-notifications')
      await expect(page.getByText(title).locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
    } finally {
      if (id) {
        await prisma.notification.deleteMany({ where: { title } }).catch(() => {})
        await prisma.announcement.delete({ where: { id } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('a trainer message reaches the client’s inbox', async ({ page }) => {
    const prisma = await makePrisma()
    const body = `E2E ping ${Date.now()}`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/messages', {
        data: { clientId: SEED.assignedClientId, body },
      })
      expect([200, 201], await res.text()).toContain(res.status())

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-messages')
      await expect(page.getByText(body).locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await prisma.message.deleteMany({ where: { body } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the trainer’s "show my phone" setting decides what the client sees', async ({ page }) => {
    const prisma = await makePrisma()
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName },
      select: { id: true, phone: true, showPhoneToClients: true },
    })
    try {
      // The phone reaches the client app as a tel: link in the shell's contact
      // row (behind the menu on a phone), so assert on the markup being SERVED
      // rather than on it being on screen — an unflagged number must not be in
      // the page at all, visible or not.
      // On a phone the contact row lives in the slide-up menu, which is only
      // rendered once opened — so open it in BOTH directions, or the "off" case
      // passes for the wrong reason.
      const telLink = 'a[href^="tel:"]'
      const openMenu = async () => {
        await dismissAppPrompt(page)
        // "Account menu" in the client shell (the trainer shell calls its
        // equivalent "More" — different app, different label).
        await page.getByRole('button', { name: 'Account menu' }).click()
        await expect(page.getByText(SEED.owner.businessName).locator('visible=true').first())
          .toBeVisible({ timeout: 10_000 })
      }

      await prisma.trainerProfile.update({
        where: { id: trainer!.id }, data: { showPhoneToClients: false },
      })
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/home')
      await openMenu()
      expect(
        await page.locator(telLink).count(),
        'the trainer has not opted in, so their number must not reach the client app',
      ).toBe(0)

      await prisma.trainerProfile.update({
        where: { id: trainer!.id }, data: { showPhoneToClients: true },
      })
      await page.reload()
      await openMenu()
      expect(
        await page.locator(telLink).count(),
        'opted in, so the client should be able to call them',
      ).toBeGreaterThan(0)
    } finally {
      await prisma.trainerProfile.update({
        where: { id: trainer!.id }, data: { showPhoneToClients: trainer!.showPhoneToClients },
      }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
