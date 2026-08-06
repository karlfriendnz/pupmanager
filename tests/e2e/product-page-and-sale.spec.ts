import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The product editor is a page now, and a product can go on sale. Both ends:
// the trainer sets a sale on the page, and the client's shop shows the reduced
// price with the original struck through.

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

async function trainerId(prisma: Db) {
  const t = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.owner.businessName }, select: { id: true },
  })
  return t!.id
}

async function makeProduct(prisma: Db, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      trainerId: await trainerId(prisma),
      name: `E2E Sale Item ${Date.now()}-${Math.round(performance.now())}`,
      priceCents: 5000,
      active: true,
      // A root-relative path — exactly what the sample-data loader writes, and
      // what used to make every product unsaveable.
      imageUrl: '/concept-products/leash.jpg',
      ...over,
    },
  })
}

test.describe('the product editor is its own page', () => {
  test('the list links to a product page, and saving there works', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const product = await makeProduct(prisma)
      id = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/products')

      // Tapping the card navigates — it is not a modal.
      await page.getByRole('link', { name: new RegExp(product.name) }).first().click()
      await page.waitForURL(`**/products/${product.id}`)
      await expect(page.getByRole('heading', { name: product.name })).toBeVisible()

      // Regression guard for the "Saving is failing" bug: this product's image
      // is a root-relative path, and saving it back used to 400.
      await page.getByLabel('Name').fill(`${product.name} v2`)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL('**/products')

      const saved = await prisma.product.findUnique({ where: { id: product.id }, select: { name: true } })
      expect(saved?.name).toBe(`${product.name} v2`)
    } finally {
      if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the page has a Purchases tab listing who has it', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const product = await makeProduct(prisma)
      id = product.id
      await prisma.productRequest.create({
        data: { clientId: SEED.assignedClientId, productId: product.id, status: 'PENDING' },
      })

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/products/${product.id}`)
      await page.getByRole('tab', { name: /Purchases/ }).click()

      await expect(page.getByText('Requested', { exact: false }).first()).toBeVisible()
    } finally {
      if (id) {
        await prisma.productRequest.deleteMany({ where: { productId: id } }).catch(() => {})
        await prisma.product.delete({ where: { id } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('another trainer’s product is a 404, not an edit form', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const rival = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.businessB.businessName }, select: { id: true },
      })
      const product = await prisma.product.create({
        data: { trainerId: rival!.id, name: `Rival item ${Date.now()}`, priceCents: 1000, active: true },
      })
      id = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.goto(`/products/${product.id}`)
      expect(res?.status()).toBe(404)

      // And the API agrees.
      const patch = await page.request.patch(`/api/products/${product.id}`, { data: { name: 'Hijacked' } })
      expect(patch.status()).toBe(404)
    } finally {
      if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})

test.describe('sale price', () => {
  test('a sale must sit below the normal price', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const product = await makeProduct(prisma)
      id = product.id
      await login(page, SEED.owner.email, SEED.owner.password)

      const tooHigh = await page.request.patch(`/api/products/${product.id}`, {
        data: { salePriceCents: 5000 },
      })
      expect(tooHigh.status()).toBe(400)
      expect(await tooHigh.text()).toContain('less than the normal price')

      const ok = await page.request.patch(`/api/products/${product.id}`, {
        data: { salePriceCents: 2500 },
      })
      expect(ok.status()).toBe(200)

      // Clearing it restores normal pricing.
      const cleared = await page.request.patch(`/api/products/${product.id}`, {
        data: { salePriceCents: null },
      })
      expect(cleared.status()).toBe(200)
      const row = await prisma.product.findUnique({
        where: { id: product.id }, select: { salePriceCents: true, priceCents: true },
      })
      expect(row?.salePriceCents).toBeNull()
      expect(row?.priceCents).toBe(5000)
    } finally {
      if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the trainer sets a sale on the page and sees the saving', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const product = await makeProduct(prisma)
      id = product.id
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/products/${product.id}`)

      await page.locator('#product-sale-price').fill('25.00')
      await expect(page.getByText(/Clients pay .*25\.00 instead of .*50\.00/)).toBeVisible()

      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL('**/products')

      const row = await prisma.product.findUnique({
        where: { id: product.id }, select: { salePriceCents: true, priceCents: true },
      })
      expect(row).toMatchObject({ priceCents: 5000, salePriceCents: 2500 })

      // The list row shows ONE price — what a client pays today — as a red
      // badge because it is on special. The row, not the name link: /products
      // is a table now and the price is its own column. The struck original,
      // the "% off" and the "Sale" flash came out of the table on 2026-08-02
      // (Karl); the product's own page still shows all of it.
      const listRow = page.getByTestId('product-row').filter({ hasText: product.name }).first()
      await expect(listRow.getByTestId('sale-price')).toHaveText(/25\.00/)
      await expect(listRow).not.toContainText('50.00')
    } finally {
      if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the CLIENT shop charges the sale price and strikes out the original', async ({ page }) => {
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      const product = await makeProduct(prisma, { salePriceCents: 2500, featured: false })
      id = product.id

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-shop')

      const card = page.getByRole('button', { name: new RegExp(product.name) }).first()
      await expect(card).toContainText('Sale')
      await expect(card).toContainText('25.00')
      await expect(card.locator('s')).toHaveText(/50\.00/)

      await card.click()
      // The detail sheet agrees — the sale price is the headline, not the £50.
      const sheet = page.locator('div.fixed.inset-0')
      await expect(sheet.getByRole('heading', { name: product.name })).toBeVisible()
      await expect(sheet.locator('s').first()).toHaveText(/50\.00/)
    } finally {
      if (id) {
        await prisma.productRequest.deleteMany({ where: { productId: id } }).catch(() => {})
        await prisma.product.delete({ where: { id } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})
