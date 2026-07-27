import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Dog owners could not sign up. /signup and /register both hardcoded
// role: 'TRAINER', so a client told "we use PupManager, go sign up" ended up
// on a trainer trial (six production accounts with no business name).
//
// This walks the fix end to end: choose a role, create a dog-owner account,
// land in the waiting room, and get approved by the trainer in one tap.
//
// It runs against Business B (Rival Dog Co), not the default business — the
// specs share ONE seeded database and Business A's enquiry list is asserted by
// mobile-schedule-enquiries / mobile-home. Everything it creates is deleted in
// afterAll.

const PHONE = { width: 390, height: 844 }

const B = SEED.businessB
const NEW_CLIENT = {
  name: 'Danny DogOwner',
  email: `self-signup-${Date.now()}@e2e.test`,
  password: 'Password123!',
  dogName: 'Biscuit',
}

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

test.afterAll(async () => {
  const prisma = await makePrisma()
  try {
    await prisma.enquiry.deleteMany({ where: { email: NEW_CLIENT.email } })
    const user = await prisma.user.findUnique({ where: { email: NEW_CLIENT.email }, select: { id: true } })
    if (user) {
      await prisma.clientProfile.deleteMany({ where: { userId: user.id } })
      await prisma.account.deleteMany({ where: { userId: user.id } })
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
    }
    await prisma.dog.deleteMany({ where: { name: NEW_CLIENT.dogName } })
  } finally {
    await prisma.$disconnect()
  }
})

test.describe('signing up as a dog owner', () => {
  test.use({ viewport: PHONE })

  test('both signup doors ask which kind of person you are first', async ({ page }) => {
    // /signup — the marketing entry.
    await page.goto('/signup')
    await expect(page.getByRole('link', { name: /I'm a dog pro/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /I'm a dog owner/i })).toBeVisible()
    // No business-name field until a role is chosen — that was the trap.
    await expect(page.getByPlaceholder('Pawsome Dog Training')).toHaveCount(0)

    // The page must not scroll sideways at 390px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(1)

    // "dog pro" leads to the trial form it always did.
    await page.getByRole('link', { name: /I'm a dog pro/i }).click()
    await page.waitForURL('**/signup?as=pro')
    await expect(page.getByPlaceholder('Pawsome Dog Training')).toBeVisible()

    // /register — the in-app entry — asks the same question.
    await page.goto('/register')
    await expect(page.getByRole('link', { name: /I'm a dog owner/i })).toBeVisible()
    await page.getByRole('link', { name: /I'm a dog owner/i }).click()
    await page.waitForURL('**/signup/client')
    await expect(page.getByText(/Who's your trainer/i)).toBeVisible()
    // Whatever else it collects, it must never ask a dog owner for a business.
    await expect(page.getByPlaceholder('Pawsome Dog Training')).toHaveCount(0)
  })

  test('a dog owner signs up, waits for their trainer, and is approved in one tap', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await page.goto('/signup/client')

      // Find the trainer by business name — the same search /find-trainer uses.
      await page.getByLabel(/Search for your trainer/i).fill(B.businessName.slice(0, 6))
      await page.getByRole('button', { name: B.businessName }).click({ timeout: 15_000 })

      await page.getByLabel('Your name').fill(NEW_CLIENT.name)
      await page.getByLabel('Your email').fill(NEW_CLIENT.email)
      await page.getByLabel('Password').fill(NEW_CLIENT.password)
      await page.getByLabel(/dog's name/i).fill(NEW_CLIENT.dogName)
      await page.getByRole('button', { name: /Create my account/i }).click()

      // …and lands in the waiting room, NOT on an empty app and NOT in a
      // /login → /home → /login loop.
      await page.waitForURL('**/find-trainer', { timeout: 30_000 })
      await expect(page.getByText(B.businessName).first()).toBeVisible()
      await expect(page.getByText(/waiting for them to accept/i).first()).toBeVisible()

      // They are a CLIENT, not a trainer on a trial. That is the whole bug.
      const created = await prisma.user.findUnique({
        where: { email: NEW_CLIENT.email },
        select: { id: true, role: true, trainerProfile: { select: { id: true } } },
      })
      expect(created?.role).toBe('CLIENT')
      expect(created?.trainerProfile).toBeNull()

      // Nothing was written into the trainer's client list yet — a public link
      // must not be able to add itself to a business record.
      expect(await prisma.clientProfile.count({ where: { userId: created!.id } })).toBe(0)

      // The trainer surface, not a dropdown: the request is in their enquiries.
      await login(page, B.ownerEmail, B.ownerPassword)
      await page.goto('/enquiries')
      await expect(page.getByText(NEW_CLIENT.name).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(/wants to join you/i).first()).toBeVisible()

      // One tap. It reuses acceptEnquiry → findOrJoinClient, so the SAME user
      // gains the profile rather than a second account being made.
      await page.getByRole('button', { name: new RegExp(`Add ${NEW_CLIENT.name} as a client`, 'i') }).click()
      await expect
        .poll(() => prisma.clientProfile.count({ where: { userId: created!.id } }), { timeout: 20_000 })
        .toBe(1)

      const users = await prisma.user.count({ where: { email: NEW_CLIENT.email } })
      expect(users, 'accepting must not create a second person').toBe(1)
    } finally {
      await prisma.$disconnect()
    }
  })

  test('a join request cannot be raised for someone else', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: B.businessName },
        select: { id: true },
      })

      // Signed out: no request, and nothing leaks about who exists.
      // maxRedirects:0 — the middleware bounces an unauthenticated request to
      // /login, and following that would turn a rejection into a 200.
      const anon = await page.request.post('/api/my/join-requests', {
        data: { trainerId: rival!.id, userId: 'somebody-else' },
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      expect([401, 302, 307], 'rejected, one way or the other').toContain(anon.status())

      // Signed in as Business A's owner: the body's userId is ignored — the
      // request is raised for the SESSION user or not at all.
      await login(page, SEED.owner.email, SEED.owner.password)
      const spoofed = await page.request.post('/api/my/join-requests', {
        data: { trainerId: rival!.id, userId: 'victim', email: SEED.client.email },
        failOnStatusCode: false,
      })
      expect(spoofed.ok()).toBe(true)
      const raised = await prisma.enquiry.findMany({
        where: { trainerId: rival!.id, email: SEED.client.email },
        select: { id: true },
      })
      expect(raised, 'no request may be raised against another person’s email').toHaveLength(0)

      // Clean up the legitimate request the owner just made for themselves.
      await prisma.enquiry.deleteMany({ where: { trainerId: rival!.id, email: SEED.owner.email } })
    } finally {
      await prisma.$disconnect()
    }
  })
})
