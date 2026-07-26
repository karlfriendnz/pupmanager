import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Achievement editing moved out of a modal onto its own page, and a badge can
// carry an uploaded image instead of an emoji.

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

type Db = Awaited<ReturnType<typeof makePrisma>>

async function makeAchievement(prisma: Db, over: Record<string, unknown> = {}) {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.owner.businessName }, select: { id: true },
  })
  return prisma.achievement.create({
    data: {
      trainerId: trainer!.id,
      name: `E2E Badge ${Date.now()}-${Math.round(performance.now())}`,
      icon: '🐾',
      color: 'amber',
      published: true,
      triggerType: 'MANUAL',
      ...over,
    },
  })
}

test.describe('achievement editing is its own page', () => {
  test('the list links to a page, and the page saves', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const badge = await makeAchievement(prisma)
      id = badge.id

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/achievements')

      await page.getByRole('link', { name: new RegExp(badge.name) }).first().click()
      await page.waitForURL(`**/achievements/${badge.id}`)
      await expect(page.getByRole('heading', { name: badge.name })).toBeVisible()

      await page.getByLabel('Name').fill(`${badge.name} v2`)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL('**/achievements')

      const saved = await prisma.achievement.findUnique({ where: { id: badge.id }, select: { name: true } })
      expect(saved?.name).toBe(`${badge.name} v2`)
    } finally {
      if (id) await prisma.achievement.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the page holds its shape at 390px — nothing scrolls sideways', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const badge = await makeAchievement(prisma)
      id = badge.id
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/achievements/${badge.id}`)
      await expect(page.getByRole('heading', { name: badge.name })).toBeVisible()

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(1)
    } finally {
      if (id) await prisma.achievement.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('another trainer’s achievement is a 404', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })
      const badge = await prisma.achievement.create({
        data: { trainerId: rival!.id, name: `Rival badge ${Date.now()}`, triggerType: 'MANUAL' },
      })
      id = badge.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.goto(`/achievements/${badge.id}`)
      expect(res?.status()).toBe(404)

      const patch = await page.request.patch(`/api/achievements/${badge.id}`, { data: { name: 'Hijacked' } })
      expect(patch.status()).toBe(404)
    } finally {
      if (id) await prisma.achievement.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})

test.describe('achievement badge image', () => {
  test('an uploaded image round-trips and replaces the emoji on the list', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const badge = await makeAchievement(prisma)
      id = badge.id
      await login(page, SEED.owner.email, SEED.owner.password)

      const url = 'https://blob.vercel-storage.com/trainer-images/e2e/badge.png'
      const res = await page.request.patch(`/api/achievements/${badge.id}`, { data: { imageUrl: url } })
      expect(res.status()).toBe(200)

      await page.goto('/achievements')
      const row = page.getByRole('link', { name: new RegExp(badge.name) }).first()
      await expect(row.locator(`img[src="${url}"]`)).toBeVisible()

      // Clearing it puts the emoji back.
      const cleared = await page.request.patch(`/api/achievements/${badge.id}`, { data: { imageUrl: null } })
      expect(cleared.status()).toBe(200)
      await page.goto('/achievements')
      await expect(page.getByRole('link', { name: new RegExp(badge.name) }).first().locator('img')).toHaveCount(0)
    } finally {
      if (id) await prisma.achievement.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a junk image URL is refused — badges render as <img> to clients', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const badge = await makeAchievement(prisma)
      id = badge.id
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.patch(`/api/achievements/${badge.id}`, {
        data: { imageUrl: 'javascript:alert(1)' },
      })
      expect(res.status()).toBe(400)

      const row = await prisma.achievement.findUnique({ where: { id: badge.id }, select: { imageUrl: true } })
      expect(row?.imageUrl).toBeNull()
    } finally {
      if (id) await prisma.achievement.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
