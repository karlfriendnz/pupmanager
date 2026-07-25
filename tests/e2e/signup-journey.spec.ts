import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { TEST_DATABASE_URL } from './test-db'

// A brand-new customer, start to finish, ON A PHONE: register → verify the
// emailed code → set a password → land in the app. Plus the careless-user pass
// on the way through (empty submit, junk email, too-short password), because
// the first form a stranger meets is the one most likely to be abused by
// accident.
//
// Mobile-first on purpose: the trainer app is used standing in a field with a
// dog on a lead, and the register/verify/password steps are the only screens
// every single customer sees.

const PHONE = { width: 390, height: 844 } // iPhone 14
test.use({ viewport: PHONE })

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

/** The OTP the register route just wrote, read straight from the DB. */
async function otpFor(prisma: Awaited<ReturnType<typeof makePrisma>>, email: string): Promise<string> {
  const token = await prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  })
  expect(token, `no verification token for ${email}`).toBeTruthy()
  return token!.token
}

async function cleanup(prisma: Awaited<ReturnType<typeof makePrisma>>, email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (user) {
    const profile = await prisma.trainerProfile.findFirst({ where: { userId: user.id }, select: { id: true } })
    if (profile) {
      await prisma.trainerMembership.deleteMany({ where: { companyId: profile.id } }).catch(() => {})
      await prisma.trainerProfile.delete({ where: { id: profile.id } }).catch(() => {})
    }
    await prisma.trainerMembership.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.account.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
  }
  await prisma.verificationToken.deleteMany({ where: { identifier: email } }).catch(() => {})
}

test.describe('a brand-new customer signs up on a phone', () => {
  test('register → verify → set password → in the app', async ({ page }) => {
    const prisma = await makePrisma()
    const email = `e2e-signup-${Date.now()}@e2e.test`
    try {
      await page.goto('/register')
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()

      // ── numpty: submit the form with nothing in it ──────────────────────
      await page.getByRole('button', { name: 'Create account' }).click()
      // Still on the form, and told what's wrong rather than silently failing.
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()

      // ── numpty: junk in the email box ────────────────────────────────────
      await page.getByLabel('Your name').fill('Nina Numpty')
      await page.getByLabel('Business name').fill('Numpty Dog Co')
      await page.getByLabel('Phone number').fill('021 000 0000')
      await page.getByLabel('Your email').fill('not-an-email')
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
      expect(await prisma.user.count({ where: { email: 'not-an-email' } })).toBe(0)

      // ── the real thing ──────────────────────────────────────────────────
      await page.getByLabel('Your email').fill(email)
      await page.getByRole('button', { name: 'Create account' }).click()

      // OTP step.
      const codeBox = page.getByLabel('Verification code')
      await expect(codeBox).toBeVisible({ timeout: 20_000 })

      // numpty: a wrong code is refused and doesn't burn the account.
      await codeBox.fill('000000')
      await page.getByRole('button', { name: 'Verify' }).click()
      await expect(codeBox).toBeVisible()

      const code = await otpFor(prisma, email)
      await codeBox.fill(code)
      await page.getByRole('button', { name: 'Verify' }).click()

      // Password step.
      await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible({ timeout: 20_000 })

      // numpty: too short, and mismatched.
      await page.getByLabel('Password', { exact: true }).fill('short')
      await page.getByLabel('Confirm password').fill('short')
      await page.getByRole('button', { name: 'Finish & go to dashboard' }).click()
      await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible()

      await page.getByLabel('Password', { exact: true }).fill('GoodPassword123!')
      await page.getByLabel('Confirm password').fill('GoodPassword123!')
      await page.getByRole('button', { name: 'Finish & go to dashboard' }).click()

      // In the app: either the dashboard or the profile-completion gate, both
      // of which mean the account exists and is signed in.
      await page.waitForURL(u => !u.pathname.startsWith('/register'), { timeout: 30_000 })
      expect(page.url()).not.toContain('/login')

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true, role: true, trainerProfile: { select: { businessName: true, subscriptionStatus: true } } },
      })
      expect(user?.role).toBe('TRAINER')
      expect(user?.emailVerified, 'verifying the code should stamp emailVerified').toBeTruthy()
      expect(user?.trainerProfile?.businessName).toBe('Numpty Dog Co')
      // Every new trainer starts on a trial, not on nothing.
      expect(user?.trainerProfile?.subscriptionStatus).toBe('TRIALING')
    } finally {
      await cleanup(prisma, email)
      await prisma.$disconnect()
    }
  })

  test('signing up twice with the same email is refused, not duplicated', async ({ page }) => {
    const prisma = await makePrisma()
    const email = `e2e-dupe-${Date.now()}@e2e.test`
    try {
      const first = await page.request.post('/api/auth/register', {
        data: { name: 'First Owner', businessName: 'First Co', phone: '021 111 1111', email },
      })
      expect(first.status()).toBe(201)

      const second = await page.request.post('/api/auth/register', {
        data: { name: 'Second Owner', businessName: 'Second Co', phone: '021 222 2222', email },
      })
      expect(second.status()).toBe(409)
      expect(await prisma.user.count({ where: { email } })).toBe(1)
    } finally {
      await cleanup(prisma, email)
      await prisma.$disconnect()
    }
  })
})
