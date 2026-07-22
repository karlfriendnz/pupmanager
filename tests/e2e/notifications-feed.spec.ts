import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Regression for the "no notifications at all" report (Paws And Thrive):
// "Payment received" rows are written with NO type, and the trainer feed
// filtered chats out with `type != 'NEW_MESSAGE'`. In SQL that comparison never
// matches a NULL, so every typed-null notification vanished and a trainer whose
// only notifications were payments saw an empty bell. Runs against the real
// embedded Postgres — a mocked Prisma can't reproduce three-valued logic.
//
// file-local login, matching the rest of the suite.
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

test.describe('trainer notifications feed', () => {
  test('a typed-null "Payment received" notification is shown; NEW_MESSAGE is not', async ({ page }) => {
    const prisma = await makePrisma()
    const stamp = Date.now()
    const payTitle = `Payment received: $50.00 [${stamp}]`
    const msgBody = `chat body should not appear [${stamp}]`
    const ids: string[] = []

    try {
      const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      expect(owner, 'seeded owner exists').toBeTruthy()

      // A real payment notification (no type), plus a chat one (typed) that must
      // stay in Messages, not this feed.
      const [payment, chat] = await Promise.all([
        prisma.notification.create({ data: { userId: owner!.id, title: payTitle, body: 'Georgie Brown paid $50.00.', link: '/finances' } }),
        prisma.notification.create({ data: { userId: owner!.id, type: 'NEW_MESSAGE', title: 'New message', body: msgBody } }),
      ])
      ids.push(payment.id, chat.id)

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/notifications')
      await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 15_000 })

      // The payment (null type) must be here — this is the reported bug.
      await expect(page.getByText(payTitle)).toBeVisible({ timeout: 15_000 })
      // The chat must not — it lives in Messages.
      await expect(page.getByText(msgBody)).toHaveCount(0)
    } finally {
      if (ids.length) await prisma.notification.deleteMany({ where: { id: { in: ids } } })
      await prisma.$disconnect()
    }
  })
})
