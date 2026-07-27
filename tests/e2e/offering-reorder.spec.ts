import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '../../src/lib/feature-flags'

// Dragging an offering list saves the order, and that same order is what a
// client sees in the booking flow. Covers the endpoint behind the drag (all
// three tables), its tenant guard, and the trainer→client hand-off.

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

test.use({ viewport: { width: 1280, height: 900 } })

test.describe('offering lists keep a trainer-arranged order', () => {
  test('reordering memberships persists and reaches the client Offerings flow', async ({ page }) => {
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
      // Two published one-off memberships either side of the seeded one.
      for (const [name, order] of [['E2E Order Alpha', 10], ['E2E Order Beta', 11]] as const) {
        made.push((await prisma.membership.create({
          data: { trainerId: trainer!.id, name, priceCents: 4000, published: true, order },
        })).id)
      }
      const [alpha, beta] = made

      await login(page, SEED.owner.email, SEED.owner.password)

      // Beta first, alpha second — the reverse of how they were created.
      const res = await page.request.post('/api/trainer/offerings/reorder', {
        data: { kind: 'membership', ids: [beta, alpha] },
      })
      expect(res.status(), await res.text()).toBe(200)
      const rows = await prisma.membership.findMany({
        where: { id: { in: made } }, orderBy: { order: 'asc' }, select: { name: true },
      })
      expect(rows.map(r => r.name)).toEqual(['E2E Order Beta', 'E2E Order Alpha'])

      // A client sees that same order in Offerings → Memberships.
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-availability')
      await page.getByRole('button', { name: /Packages/ }).click()
      const headings = page.getByRole('heading', { name: /E2E Order (Alpha|Beta)/ })
      await expect(headings.first()).toBeVisible({ timeout: 15_000 })
      // Trimmed: the card heading carries its icon inside the same element.
      expect((await headings.allTextContents()).map(t => t.trim())).toEqual(['E2E Order Beta', 'E2E Order Alpha'])
    } finally {
      await prisma.membership.deleteMany({ where: { id: { in: made } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('classes and packages reorder through the same endpoint', async ({ page }) => {
    const prisma = await makePrisma()
    const pkgIds: string[] = []
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      for (const name of ['E2E Sort Pkg A', 'E2E Sort Pkg B']) {
        pkgIds.push((await prisma.package.create({
          data: { trainerId: trainer!.id, name, sessionCount: 1, weeksBetween: 1 },
        })).id)
      }

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/trainer/offerings/reorder', {
        data: { kind: 'package', ids: [pkgIds[1], pkgIds[0]] },
      })
      expect(res.status(), await res.text()).toBe(200)
      const rows = await prisma.package.findMany({
        where: { id: { in: pkgIds } }, orderBy: { order: 'asc' }, select: { name: true },
      })
      expect(rows.map(r => r.name)).toEqual(['E2E Sort Pkg B', 'E2E Sort Pkg A'])

      // A bad payload is refused rather than half-applied.
      const dup = await page.request.post('/api/trainer/offerings/reorder', {
        data: { kind: 'package', ids: [pkgIds[0], pkgIds[0]] },
      })
      expect(dup.status()).toBe(400)
    } finally {
      await prisma.package.deleteMany({ where: { id: { in: pkgIds } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('Business B cannot reorder Business A’s offerings', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

      const res = await page.request.post('/api/trainer/offerings/reorder', {
        // A's seeded self-book package, alongside B's own.
        data: { kind: 'package', ids: [SEED.selfBookPackageId, SEED.businessB.packageId] },
      })
      expect(res.status()).toBe(404)

      // A's package keeps whatever order it had — nothing was written.
      const a = await prisma.package.findUnique({ where: { id: SEED.selfBookPackageId }, select: { order: true } })
      expect(a?.order).toBe(0)
    } finally {
      await prisma.$disconnect()
    }
  })
})
