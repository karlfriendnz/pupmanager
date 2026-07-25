import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { NOTIFICATION_TYPES } from '../../src/lib/notification-types'

// Every notification type, rendered for real. The registry says what the app
// can send; this proves each one survives the trip to the feed — no crash, no
// blank row — for both the trainer's bell and the dog owner's.
//
// Written after finding CLIENT_PAYMENT_REQUEST had no icon and was rendering as
// a generic bell: the registry was complete, the presentation wasn't, and
// nothing compared the two.

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

const ALL_TYPES = Object.keys(NOTIFICATION_TYPES)
// Client-facing types live on the dog owner's feed; the rest are the trainer's.
const CLIENT_TYPES = ALL_TYPES.filter(t => t.startsWith('CLIENT_') || t === 'TRAINER_COMMENTED_LOG')
// NEW_MESSAGE is deliberately absent from the trainer's feed — chats belong in
// Messages, and duplicating them in the bell was the old behaviour. It still
// gets a notification row (that's what drives the Messages badge); it just
// isn't listed here.
const FEED_EXCLUDED = ['NEW_MESSAGE']
const TRAINER_TYPES = ALL_TYPES.filter(t => !CLIENT_TYPES.includes(t) && !FEED_EXCLUDED.includes(t))

const STAMP = `E2E-NOTIF-${Date.now()}`

async function seedFor(
  prisma: Awaited<ReturnType<typeof makePrisma>>,
  userId: string,
  types: string[],
) {
  await prisma.notification.createMany({
    data: types.map(type => ({
      userId,
      type: type as never,
      title: `${STAMP} ${type}`,
      body: `A ${type} notification, rendered end to end.`,
    })),
  })
}

test.describe('every notification type renders where it belongs', () => {
  test('the dog owner’s feed renders every client-facing type', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const user = await prisma.user.findUnique({ where: { email: SEED.client.email }, select: { id: true } })
      await seedFor(prisma, user!.id, CLIENT_TYPES)

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-notifications')

      const missing: string[] = []
      for (const type of CLIENT_TYPES) {
        const row = page.getByText(`${STAMP} ${type}`).locator('visible=true').first()
        if (!(await row.isVisible().catch(() => false))) missing.push(type)
      }
      expect(missing, `client notifications that did not render:\n${missing.join('\n')}`).toEqual([])

      // The rows carry their body copy too, not just a bare title.
      await expect(
        page.getByText('rendered end to end').locator('visible=true').first(),
      ).toBeVisible()
    } finally {
      await prisma.notification.deleteMany({ where: { title: { startsWith: STAMP } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the trainer’s bell renders every trainer-facing type', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const user = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      await seedFor(prisma, user!.id, TRAINER_TYPES)

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/notifications')

      // The excluded one must still NOT be on the feed — that's the behaviour,
      // not an accident.
      await seedFor(prisma, user!.id, FEED_EXCLUDED)

      const missing: string[] = []
      for (const type of TRAINER_TYPES) {
        const row = page.getByText(`${STAMP} ${type}`).locator('visible=true').first()
        if (!(await row.isVisible().catch(() => false))) missing.push(type)
      }
      expect(missing, `trainer notifications that did not render:\n${missing.join('\n')}`).toEqual([])

      for (const type of FEED_EXCLUDED) {
        await expect(
          page.getByText(`${STAMP} ${type}`),
          `${type} belongs in Messages, not the bell`,
        ).toHaveCount(0)
      }
    } finally {
      await prisma.notification.deleteMany({ where: { title: { startsWith: STAMP } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // A notification nobody can read is worse than none: the unread count is what
  // drives the badge, so opening the feed has to settle it.
  test('unread notifications count, and reading them clears the badge', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const user = await prisma.user.findUnique({ where: { email: SEED.client.email }, select: { id: true } })
      await seedFor(prisma, user!.id, ['CLIENT_NEW_MESSAGE', 'CLIENT_SESSION_REMINDER'])

      const unreadBefore = await prisma.notification.count({ where: { userId: user!.id, readAt: null } })
      expect(unreadBefore).toBeGreaterThanOrEqual(2)

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-notifications')
      await expect(page.getByText(`${STAMP} CLIENT_NEW_MESSAGE`).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // Opening the feed marks them read — give the request a moment to land.
      await expect.poll(
        async () => prisma.notification.count({ where: { userId: user!.id, readAt: null } }),
        { timeout: 15_000, message: 'opening the feed should clear the unread badge' },
      ).toBe(0)
    } finally {
      await prisma.notification.deleteMany({ where: { title: { startsWith: STAMP } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
