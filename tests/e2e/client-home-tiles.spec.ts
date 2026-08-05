/**
 * The client home's quick actions — a tile only exists when it goes somewhere.
 *
 * The Bookings tile opens /my-availability. A trainer with nothing a client can
 * self-book renders that page's empty state, so the tile was a shortcut to a
 * dead end (Karl, 2026-08-06: "booking button should not show if there is
 * nothing to book").
 *
 * Both directions are proven against real data, on two real businesses:
 *   • Business B has one package and it is NOT self-bookable → no tile.
 *   • Business A has the seeded Self-Book Session → tile, and it opens.
 *
 * The dog owners are this spec's own and are torn down again — global-setup and
 * every other spec's counts are untouched.
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { SEED, TEST_DATABASE_URL } from './test-db'

const PASSWORD = 'Password123!'

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}
type Prisma = Awaited<ReturnType<typeof makePrisma>>

async function makeClient(prisma: Prisma, trainerId: string, tag: string) {
  const email = `tiles-${tag}@e2e.test`
  const hash = await bcrypt.hash(PASSWORD, 12)
  const user = await prisma.user.create({
    data: {
      email, name: 'Tile Owner', role: 'CLIENT', emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const dog = await prisma.dog.create({ data: { name: `Tile Dog ${tag}` } })
  const client = await prisma.clientProfile.create({
    data: { userId: user.id, trainerId, dogId: dog.id, status: 'ACTIVE', phone: '+6421000123' },
  })
  const cleanup = async () => {
    await prisma.clientProfile.update({ where: { id: client.id }, data: { dogId: null } })
    await prisma.dog.delete({ where: { id: dog.id } })
    await prisma.clientProfile.delete({ where: { id: client.id } })
    await prisma.account.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
  return { email, clientId: client.id, cleanup }
}

async function loginAs(page: Page, email: string, clientId: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.context().addCookies([
    { name: 'pm-active-trainer', value: clientId, domain: 'localhost', path: '/' },
  ])
}

const quickActions = (page: Page) => page.getByRole('navigation', { name: 'Quick actions' })

test.describe('client home quick actions', () => {
  test('the bookings tile shows only when there is something to book', async ({ page }) => {
    const prisma = await makePrisma()
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
    let withNothing: Awaited<ReturnType<typeof makeClient>> | undefined
    let withSomething: Awaited<ReturnType<typeof makeClient>> | undefined
    try {
      const businessA = await prisma.trainerProfile.findFirstOrThrow({
        where: { user: { email: SEED.owner.email } },
      })
      const businessB = await prisma.trainerProfile.findFirstOrThrow({
        where: { user: { email: SEED.businessB.ownerEmail } },
      })
      withNothing = await makeClient(prisma, businessB.id, `b${tag}`)
      withSomething = await makeClient(prisma, businessA.id, `a${tag}`)

      // ── nothing to book: no tile, and the page it would open is empty ──────
      await loginAs(page, withNothing.email, withNothing.clientId)
      await page.goto('/home')
      const bare = quickActions(page)
      await expect(bare).toBeVisible({ timeout: 20_000 })
      await expect(bare.locator('a[href="/my-availability"]')).toHaveCount(0)
      // Message is always there, so the row has one tile and one column.
      await expect(bare.locator('a')).toHaveCount(1)
      await expect(bare).toHaveClass(/grid-cols-1/)

      // The tile is hidden because the destination is empty — not for some
      // other reason that happens to agree today.
      await page.goto('/my-availability')
      await expect(page.getByText('What would you like to book?')).toHaveCount(0)

      // ── something to book: the tile is back, and it opens ─────────────────
      await loginAs(page, withSomething.email, withSomething.clientId)
      await page.goto('/home')
      const full = quickActions(page)
      await expect(full.locator('a[href="/my-availability"]')).toHaveCount(1, { timeout: 20_000 })
      await full.locator('a[href="/my-availability"]').click()
      await page.waitForURL('**/my-availability', { timeout: 20_000 })
      await expect(page.getByText('What would you like to book?')).toBeVisible({ timeout: 20_000 })
    } finally {
      await withSomething?.cleanup().catch(() => {})
      await withNothing?.cleanup().catch(() => {})
      await prisma.$disconnect()
    }
  })
})
