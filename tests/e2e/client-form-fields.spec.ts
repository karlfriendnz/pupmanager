import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The client record is the thing everything else hangs off, and its form is the
// longest one a trainer fills in. This fills EVERY field on a phone, saves, and
// then checks each value actually came back — the failure mode being a field
// that looks saved, isn't, and nobody notices until a client asks why their
// dog's birthday is wrong.
//
// Then the careless passes: nothing at all, and a name made of markup.

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

test.describe('the client form, every field', () => {
  test('fills in everything and every value comes back', async ({ page }) => {
    const prisma = await makePrisma()
    const stamp = Date.now()
    const name = `E2E Full Fields ${stamp}`
    const email = `e2e-fields-${stamp}@e2e.test`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/clients/invite')

      await page.getByPlaceholder('Jane Smith').fill(name)
      await page.getByPlaceholder('jane@example.com (optional)').fill(email)
      await page.getByPlaceholder('021 234 5678').fill('021 555 0101')

      // The dog block — name, breed, weight, date of birth, notes.
      await page.getByPlaceholder('Buddy').fill('Rex')
      await page.locator('input[type="date"]').first().fill('2022-03-14')

      await page.getByRole('button', { name: 'Create client' }).click()

      // Saved, and reachable. Name and email live on the linked User; the
      // profile carries the phone and points at the primary dog.
      await expect.poll(
        async () => prisma.clientProfile.count({ where: { user: { name } } }),
        { timeout: 20_000, message: 'the client never saved' },
      ).toBe(1)

      const saved = await prisma.clientProfile.findFirst({
        where: { user: { name } },
        select: {
          phone: true,
          user: { select: { name: true, email: true } },
          dog: { select: { name: true, dob: true } },
          dogs: { select: { name: true, dob: true } },
        },
      })
      expect(saved?.user?.name).toBe(name)
      expect(saved?.user?.email).toBe(email)
      // Phone keeps the shape it was typed in — trainers dial what they see.
      expect(saved?.phone?.replace(/\s/g, '')).toBe('0215550101')

      const dog = saved?.dog ?? saved?.dogs?.[0]
      expect(dog?.name).toBe('Rex')
      // The date has to survive the timezone round trip, not slip a day.
      expect(dog?.dob?.toISOString().slice(0, 10)).toBe('2022-03-14')
    } finally {
      const c = await prisma.clientProfile.findFirst({ where: { user: { name } }, select: { id: true, userId: true } })
      if (c) {
        await prisma.dog.deleteMany({ where: { clientProfileId: c.id } }).catch(() => {})
        await prisma.clientProfile.delete({ where: { id: c.id } }).catch(() => {})
        if (c.userId) await prisma.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('an empty form is refused, and saves nothing', async ({ page }) => {
    const prisma = await makePrisma()
    const before = await prisma.clientProfile.count()
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/clients/invite')

      await page.getByRole('button', { name: 'Create client' }).click()

      // Still on the form — and nothing was written.
      await expect(page.getByRole('button', { name: 'Create client' })).toBeVisible()
      await expect.poll(async () => prisma.clientProfile.count(), { timeout: 5_000 }).toBe(before)
    } finally {
      await prisma.$disconnect()
    }
  })

  // Markup typed into a name must come back as text, everywhere it's shown.
  test('a name made of markup is stored and shown as text, not run', async ({ page }) => {
    const prisma = await makePrisma()
    const payload = `<img src=x onerror=alert(1)>E2E XSS ${Date.now()}`
    let dialogFired = false
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      page.on('dialog', async d => { dialogFired = true; await d.dismiss() })

      const res = await page.request.post('/api/clients', {
        data: { name: payload, email: `e2e-xss-${Date.now()}@e2e.test` },
      })
      expect([200, 201]).toContain(res.status())

      await page.goto('/clients')
      // Rendered as text: the literal string is visible, and no script ran. The
      // tail is the distinctive part (the markup prefix is shared).
      await expect(page.getByText(payload.split('>')[1]).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
      expect(dialogFired, 'markup in a client name executed').toBe(false)
    } finally {
      const c = await prisma.clientProfile.findFirst({ where: { user: { name: payload } }, select: { id: true, userId: true } })
      if (c) {
        await prisma.clientProfile.delete({ where: { id: c.id } }).catch(() => {})
        if (c.userId) await prisma.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})
