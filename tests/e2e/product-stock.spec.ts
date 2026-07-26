import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Stock, end to end: it goes down when something is sold, it stops the sale at
// zero, the trainer can put more on the shelf, and a product that isn't
// counted is never affected by any of it.

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

async function makeProduct(prisma: Awaited<ReturnType<typeof makePrisma>>, stockCount: number | null) {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.owner.businessName }, select: { id: true },
  })
  return prisma.product.create({
    data: {
      trainerId: trainer!.id,
      name: `E2E Stock Item ${Date.now()}-${Math.round(performance.now())}`,
      priceCents: 1500,
      active: true,
      stockCount,
    },
  })
}

test.describe('product stock', () => {
  test('a sale takes one off the shelf', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 3)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect([200, 201], await res.text()).toContain(res.status())

      const after = await prisma.product.findUnique({
        where: { id: product.id }, select: { stockCount: true },
      })
      expect(after?.stockCount, 'three on the shelf, one sold').toBe(2)
    } finally {
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('the last one can be sold, and the next sale is refused', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 1)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)

      const first = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect([200, 201]).toContain(first.status())
      expect((await prisma.product.findUnique({ where: { id: product.id }, select: { stockCount: true } }))?.stockCount).toBe(0)

      // The route is idempotent per PENDING request, so sell to a second client.
      const second = await page.request.post(`/api/clients/${SEED.unassignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect(second.status(), 'nothing left to sell').toBe(409)

      // And it never goes negative.
      expect((await prisma.product.findUnique({ where: { id: product.id }, select: { stockCount: true } }))?.stockCount).toBe(0)
    } finally {
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('an untracked product is never counted and never runs out', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, null)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      for (const clientId of [SEED.assignedClientId, SEED.unassignedClientId]) {
        const res = await page.request.post(`/api/clients/${clientId}/product-requests`, {
          data: { productId: product.id },
        })
        expect([200, 201], await res.text()).toContain(res.status())
      }

      const after = await prisma.product.findUnique({
        where: { id: product.id }, select: { stockCount: true },
      })
      expect(after?.stockCount, 'an uncounted product stays uncounted').toBeNull()
    } finally {
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('the trainer can put more on the shelf', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 0)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)

      // Sold out to begin with.
      const soldOut = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect(soldOut.status()).toBe(409)

      // A delivery arrives.
      const restock = await page.request.patch(`/api/products/${product.id}`, { data: { stockCount: 10 } })
      expect(restock.status(), await restock.text()).toBe(200)
      expect((await prisma.product.findUnique({ where: { id: product.id }, select: { stockCount: true } }))?.stockCount).toBe(10)

      // And it sells again.
      const now = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect([200, 201], await now.text()).toContain(now.status())
      expect((await prisma.product.findUnique({ where: { id: product.id }, select: { stockCount: true } }))?.stockCount).toBe(9)
    } finally {
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('a client sees the count, and cannot buy what has run out', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 2)
      productId = product.id

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-shop')
      const later = page.getByRole('button', { name: 'Maybe later' })
      if (await later.isVisible().catch(() => false)) await later.click()

      await page.getByText(product.name).locator('visible=true').first().click()
      await expect(page.getByText('Only 2 left').locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // Empty the shelf and look again.
      await prisma.product.update({ where: { id: product.id }, data: { stockCount: 0 } })
      await page.reload()
      if (await later.isVisible().catch(() => false)) await later.click()
      await page.getByText(product.name).locator('visible=true').first().click()

      await expect(page.getByText(/Out of stock/).locator('visible=true').first()).toBeVisible()
      // The client's own purchase route refuses it too, not just the button.
      const buy = await page.request.post(`/api/my/products/${product.id}/request`, { data: {} })
      expect(buy.status()).toBe(409)
    } finally {
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})
