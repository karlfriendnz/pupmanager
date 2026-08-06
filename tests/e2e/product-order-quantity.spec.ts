import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Ordering more than one of a thing, against a real database.
//
// Karl: "when ordering a product i should be able to say I want 2 of these."
//
// Everything here is a COUNT matching a COUNT. Ordering does three things —
// units off the shelf, the request row, the receivable — and cancelling has to
// do the same number of them in reverse (AGENTS.md #4). The unit tests pin the
// arithmetic against mocks; these pin it against Postgres, which is the only
// place a defaulted column, a CHECK constraint and an invoice line can be
// proved to agree.
//
// And the round trip (AGENTS.md #1): a quantity the trainer typed has to still
// be three after a reload. "It saved fine" has been wrong three times here.

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
      name: `E2E Qty Item ${Date.now()}-${Math.round(performance.now())}`,
      priceCents: 2000,
      active: true,
      stockCount,
    },
  })
}

/** Everything this spec created, gone — specs share one seeded database. */
async function cleanup(prisma: Awaited<ReturnType<typeof makePrisma>>, productId: string | null) {
  if (!productId) return
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { sourceId: productId } } }).catch(() => {})
  await prisma.invoice.deleteMany({ where: { sourceType: 'PRODUCT', sourceId: productId } }).catch(() => {})
  await prisma.stockMovement.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
  await prisma.product.delete({ where: { id: productId } }).catch(() => {})
}

const stockOf = async (prisma: Awaited<ReturnType<typeof makePrisma>>, id: string) =>
  (await prisma.product.findUnique({ where: { id }, select: { stockCount: true } }))?.stockCount

test.describe('ordering more than one', () => {
  test('three of something takes three off the shelf and bills for three', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 3 },
      })
      expect([200, 201], await res.text()).toContain(res.status())

      expect(await stockOf(prisma, product.id), 'ten on the shelf, three sold').toBe(7)

      // One movement for the whole take, not three of one.
      const movements = await prisma.stockMovement.findMany({ where: { productId: product.id, reason: 'SOLD' } })
      expect(movements).toHaveLength(1)
      expect(movements[0].delta).toBe(-3)
      expect(movements[0].balanceAfter).toBe(7)

      // ONE row for the order, carrying the number.
      const rows = await prisma.productRequest.findMany({ where: { productId: product.id, status: 'PENDING' } })
      expect(rows).toHaveLength(1)
      expect(rows[0].quantity).toBe(3)

      // And the money: 3 × $20.
      const invoice = await prisma.invoice.findFirst({
        where: { sourceType: 'PRODUCT', sourceId: product.id },
        include: { lines: true },
      })
      expect(invoice?.amountCents, 'three at $20').toBe(6000)
      expect(invoice?.lines).toHaveLength(1)
      expect(invoice?.lines[0].quantity).toBe(3)
      expect(invoice?.lines[0].unitAmountCents).toBe(2000)
      expect(invoice?.lines[0].amountCents).toBe(6000)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('the quantity survives a reload — it is on the row, not in the browser', async ({ page }) => {
    // AGENTS.md #1. The only proof a field saved is reading it back from a
    // fresh request, and this one is read back through the APP (the add screen
    // renders the stepper from it), not just out of the table.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 4 },
      })

      // A fresh page load of the trainer's products list for this client. The
      // count is its own element inside the chip (it is bolder than the name),
      // so the chip is what carries both.
      await page.goto(`/clients/${SEED.assignedClientId}/products`)
      const chip = page.locator('span', { hasText: product.name }).last()
      await expect(chip).toContainText('× 4')

      // And the add screen's stepper starts from four, not from one — the
      // control reads the order, it does not start counting again.
      await page.goto(`/clients/${SEED.assignedClientId}/products/add`)
      const stepper = page.getByRole('button', { name: 'One more of this product' })
      await expect(stepper).toBeVisible()
      await expect(stepper.locator('xpath=..')).toContainText('4')
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('adding the same product twice increases the quantity', async ({ page }) => {
    // It used to return the existing row and do nothing at all — no stock, no
    // money, and the second tap indistinguishable from the first.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const url = `/api/clients/${SEED.assignedClientId}/product-requests`

      await page.request.post(url, { data: { productId: product.id, quantity: 2 } })
      const second = await page.request.post(url, { data: { productId: product.id, quantity: 3 } })
      expect([200, 201], await second.text()).toContain(second.status())

      const rows = await prisma.productRequest.findMany({ where: { productId: product.id, status: 'PENDING' } })
      expect(rows, 'one order, not two').toHaveLength(1)
      expect(rows[0].quantity, '2 then 3 more').toBe(5)
      expect(await stockOf(prisma, product.id), 'five off a shelf of ten').toBe(5)

      // ONE receivable, re-priced rather than duplicated.
      const invoices = await prisma.invoice.findMany({
        where: { sourceType: 'PRODUCT', sourceId: product.id },
        include: { lines: true },
      })
      expect(invoices).toHaveLength(1)
      expect(invoices[0].amountCents, 'five at $20').toBe(10000)
      expect(invoices[0].lines[0].quantity).toBe(5)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('a re-order after a cancellation is a new order, and it is not free', async ({ page }) => {
    // AGENTS.md #7. The cancelled row must not stand in for a live one — on the
    // order OR on the invoice. That exact bug has shipped here: the idempotency
    // check found the CANCELLED invoice and raised nothing.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const url = `/api/clients/${SEED.assignedClientId}/product-requests`

      const first = await page.request.post(url, { data: { productId: product.id, quantity: 2 } })
      const firstRow = await first.json()

      const cancelled = await page.request.patch(`/api/product-requests/${firstRow.id}`, {
        data: { status: 'CANCELLED' },
      })
      expect(cancelled.status(), await cancelled.text()).toBe(200)
      expect(await stockOf(prisma, product.id), 'both units back on the shelf').toBe(10)

      // Order it again.
      const again = await page.request.post(url, { data: { productId: product.id, quantity: 1 } })
      expect([200, 201], await again.text()).toContain(again.status())
      const againRow = await again.json()
      expect(againRow.id, 'a NEW order, not the cancelled one').not.toBe(firstRow.id)
      expect(againRow.quantity).toBe(1)
      expect(await stockOf(prisma, product.id)).toBe(9)

      // And there is money owed for it: the cancelled invoice is not a live one.
      const live = await prisma.invoice.findMany({
        where: { sourceType: 'PRODUCT', sourceId: product.id, status: 'UNPAID' },
      })
      expect(live, 'the re-order was invoiced').toHaveLength(1)
      expect(live[0].amountCents).toBe(2000)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('cancelling puts back exactly as many as it took, and cancels the receivable', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const created = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 4 },
      })
      const row = await created.json()
      expect(await stockOf(prisma, product.id)).toBe(6)

      const res = await page.request.patch(`/api/product-requests/${row.id}`, {
        data: { status: 'CANCELLED' },
      })
      expect(res.status(), await res.text()).toBe(200)

      expect(await stockOf(prisma, product.id), 'four out, four back').toBe(10)
      const returned = await prisma.stockMovement.findFirst({
        where: { productId: product.id, reason: 'RETURNED' },
      })
      expect(returned?.delta, 'one movement for all four').toBe(4)

      const invoice = await prisma.invoice.findFirst({
        where: { sourceType: 'PRODUCT', sourceId: product.id },
      })
      expect(invoice?.status).toBe('CANCELLED')
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('a PAID invoice is left alone — a refund is the trainer’s decision', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const created = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 3 },
      })
      const row = await created.json()

      // The client pays it.
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { sourceType: 'PRODUCT', sourceId: product.id },
      })
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } })

      // Now it can't be grown…
      const grow = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 2 },
      })
      expect(grow.status(), 'money has moved — the trainer decides').toBe(409)
      expect(await stockOf(prisma, product.id), 'and nothing came off the shelf').toBe(7)

      // …and cancelling still returns the stock but never touches the money.
      const cancelled = await page.request.patch(`/api/product-requests/${row.id}`, {
        data: { status: 'CANCELLED' },
      })
      expect(cancelled.status()).toBe(200)
      expect(await stockOf(prisma, product.id), 'the client is not getting them either way').toBe(10)
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(after.status, 'a refund is not something a tap decides').toBe('PAID')
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('more than is on the shelf is refused outright, not part-filled', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 2)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 5 },
      })
      expect(res.status()).toBe(409)
      expect((await res.json()).error, 'it says how many are actually left').toMatch(/Only 2 of/)

      // ALL OR NOTHING: no half order, no half receivable.
      expect(await stockOf(prisma, product.id), 'untouched').toBe(2)
      expect(await prisma.productRequest.count({ where: { productId: product.id } })).toBe(0)
      expect(await prisma.invoice.count({ where: { sourceType: 'PRODUCT', sourceId: product.id } })).toBe(0)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('the browser control is not the check', async ({ page }) => {
    // AGENTS.md #3. Straight at the route, past the stepper's min/max/step.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      for (const quantity of [0, -1, 2.5, 21, 9999]) {
        const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
          data: { productId: product.id, quantity },
        })
        expect(res.status(), `quantity ${quantity}`).toBe(400)
      }
      expect(await stockOf(prisma, product.id), 'nothing moved').toBe(10)
      expect(await prisma.productRequest.count({ where: { productId: product.id } })).toBe(0)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('a request with no quantity still means one', async ({ page }) => {
    // Every caller that predates the control, and every phone still running the
    // old build. This is the whole reason the column is DEFAULT 1.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id },
      })
      expect([200, 201], await res.text()).toContain(res.status())

      const row = await prisma.productRequest.findFirstOrThrow({ where: { productId: product.id } })
      expect(row.quantity).toBe(1)
      expect(await stockOf(prisma, product.id)).toBe(9)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('the stepper can take an order back down, and the shelf agrees', async ({ page }) => {
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const created = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 5 },
      })
      const row = await created.json()
      expect(await stockOf(prisma, product.id)).toBe(5)

      const down = await page.request.patch(`/api/product-requests/${row.id}`, { data: { quantity: 2 } })
      expect(down.status(), await down.text()).toBe(200)
      expect((await down.json()).quantity).toBe(2)

      expect(await stockOf(prisma, product.id), 'three of the five came back').toBe(8)
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { sourceType: 'PRODUCT', sourceId: product.id },
        include: { lines: true },
      })
      expect(invoice.amountCents, 're-priced for two').toBe(4000)
      expect(invoice.lines[0].quantity).toBe(2)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })

  test('another trainer’s client cannot be ordered for, whatever the quantity', async ({ page }) => {
    // The bounds are not a substitute for the tenant guard, and vice versa.
    const prisma = await makePrisma()
    let productId: string | null = null
    try {
      const product = await makeProduct(prisma, 10)
      productId = product.id

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/product-requests`, {
        data: { productId: product.id, quantity: 3 },
      })
      expect(res.status()).toBe(404)
      expect(await stockOf(prisma, product.id), 'nothing moved').toBe(10)
    } finally {
      await cleanup(prisma, productId)
      await prisma.$disconnect()
    }
  })
})
