import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { PRODUCT_SEARCH_THRESHOLD, sellableProducts } from '../../src/lib/sale-cart'

// The instant sale is a three-step wizard: find the customer, add the items,
// then take the money. This drives it end to end on a phone — including the
// part that used to be impossible, stepping BACK through it without losing the
// cart, and the part that used to be dangerous: a "next" button that must never
// double as "save" (see commit 8ec9c36).

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE })

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

type Db = Awaited<ReturnType<typeof makePrisma>>

async function loginOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function trainerId(prisma: Db) {
  const t = await prisma.trainerProfile.findFirst({
    where: { businessName: SEED.owner.businessName }, select: { id: true },
  })
  return t!.id
}

/** Instant sale is a free add-on, but off until switched on — the "+" hides it otherwise. */
async function enableInstantSale(page: Page) {
  const res = await page.request.post('/api/addons', { data: { itemId: 'pos', active: true } })
  expect(res.ok(), `enabling the pos add-on failed: ${res.status()}`).toBe(true)
}

/** Manual (instant-sale) invoices for the seeded client — the suite shares a DB. */
async function manualSaleCount(prisma: Db) {
  return prisma.invoice.count({ where: { clientId: SEED.assignedClientId, sourceType: 'MANUAL' } })
}

/** How many products the composer would show right now, before this spec adds any. */
async function existingSellableCount(prisma: Db) {
  const rows = await prisma.product.findMany({
    where: { trainerId: await trainerId(prisma) },
    select: { id: true, name: true, priceCents: true, salePriceCents: true, imageUrl: true, active: true },
  })
  return sellableProducts(rows).length
}

async function makeProducts(prisma: Db, names: string[], over: Record<string, unknown> = {}) {
  const id = await trainerId(prisma)
  const made = []
  for (const name of names) {
    made.push(await prisma.product.create({
      data: {
        trainerId: id,
        name,
        priceCents: 800,
        active: true,
        imageUrl: '/concept-products/leash.jpg',
        ...over,
      },
    }))
  }
  return made
}

/**
 * Open the composer the way a trainer does: the mobile "+" → New sale.
 *
 * From /clients rather than /dashboard — the dashboard greets a fresh business
 * with the personalisation wizard, which covers the header the "+" lives in.
 * The "+" is in the mobile header on every trainer page, so any of them will do.
 */
async function openComposer(page: Page) {
  await page.goto('/clients?tab=never')
  // exact, because getByRole name-matching is a SUBSTRING match by default and
  // "Create new client" also contains "Create". The one wanted here is the
  // mobile header "+", whose aria-label is exactly "Create".
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: /New sale/ }).click()
  await expect(page.getByRole('dialog', { name: 'New sale' })).toBeVisible()
}

test.describe('the instant sale is a step process', () => {
  test('customer → items → payment, and stepping back keeps the cart', async ({ page }) => {
    const prisma = await makePrisma()
    const made: string[] = []
    let invoiceId: string | null = null
    try {
      const stamp = `${Date.now()}`
      const [treats, lead] = await makeProducts(prisma, [`E2E Treats ${stamp}`, `E2E Lead ${stamp}`])
      made.push(treats.id, lead.id)
      const salesBefore = await manualSaleCount(prisma)

      await loginOwner(page)
      await enableInstantSale(page)
      await openComposer(page)

      // ── Step 1: who's it for ───────────────────────────────────────────────
      const dialog = page.getByRole('dialog', { name: 'New sale' })
      await expect(dialog.getByRole('heading', { name: 'Who’s it for?' })).toBeVisible()
      await expect(dialog.getByText('Step 1 of 3')).toBeVisible()
      // Step one has nowhere to go back to.
      await expect(dialog.getByRole('button', { name: 'Back' })).toHaveCount(0)

      await dialog.getByLabel('Search clients or dogs').fill('Sarah')
      await dialog.getByRole('button', { name: new RegExp(SEED.client.name) }).first().click()

      // ── Step 2: what are they buying ───────────────────────────────────────
      await expect(dialog.getByRole('heading', { name: 'What are they buying?' })).toBeVisible()
      await expect(dialog.getByText(`Step 2 of 3 · ${SEED.client.name}`)).toBeVisible()

      // Products are picture tiles, not text rows — the image sits above the name.
      const tile = dialog.getByRole('button', { name: `Add ${treats.name}` })
      await expect(tile.locator('img')).toBeVisible()
      await expect(tile).toContainText('8.00')

      await tile.click()
      await expect(dialog.getByLabel(`Quantity of ${treats.name}`)).toHaveText('1')
      // Tapping the same tile again stacks the line rather than duplicating it.
      await tile.click()
      await expect(dialog.getByLabel(`Quantity of ${treats.name}`)).toHaveText('2')
      // …and so does the "+" on the cart row.
      await dialog.getByRole('button', { name: `One more ${treats.name}` }).click()
      await expect(dialog.getByLabel(`Quantity of ${treats.name}`)).toHaveText('3')

      await dialog.getByRole('button', { name: `Add ${lead.name}` }).click()
      // 3 × 8 + 1 × 8 = 32.00 (symbol left out — the app is multi-currency).
      await expect(dialog.getByText(/32\.00/).first()).toBeVisible()

      // ── Step 3: how are they paying ────────────────────────────────────────
      await dialog.getByRole('button', { name: 'Continue to payment' }).click()
      await expect(dialog.getByRole('heading', { name: 'How are they paying?' })).toBeVisible()
      await expect(dialog.getByText('Step 3 of 3')).toBeVisible()
      await expect(dialog.getByRole('button', { name: /Take payment now/ })).toBeVisible()
      await expect(dialog.getByRole('button', { name: /Record as unpaid/ })).toBeVisible()
      // Nothing has been rung up yet — reaching the last step is not saving.
      expect(await manualSaleCount(prisma)).toBe(salesBefore)

      // ── Back, all the way, and the sale survives ───────────────────────────
      await dialog.getByRole('button', { name: 'Back' }).click()
      await expect(dialog.getByRole('heading', { name: 'What are they buying?' })).toBeVisible()
      await expect(dialog.getByLabel(`Quantity of ${treats.name}`)).toHaveText('3')

      await dialog.getByRole('button', { name: 'Back' }).click()
      await expect(dialog.getByRole('heading', { name: 'Who’s it for?' })).toBeVisible()
      // The search box kept what was typed, so re-picking is one tap.
      await expect(dialog.getByLabel('Search clients or dogs')).toHaveValue('Sarah')
      await dialog.getByRole('button', { name: new RegExp(SEED.client.name) }).first().click()

      await expect(dialog.getByLabel(`Quantity of ${treats.name}`)).toHaveText('3')
      await expect(dialog.getByText(/32\.00/).first()).toBeVisible()

      // ── Record it ──────────────────────────────────────────────────────────
      await dialog.getByRole('button', { name: 'Continue to payment' }).click()
      await dialog.getByRole('button', { name: /Record as unpaid/ }).click()
      await expect(dialog.getByRole('heading', { name: 'Sale recorded' })).toBeVisible()

      const invoice = await prisma.invoice.findFirst({
        where: { clientId: SEED.assignedClientId, sourceType: 'MANUAL' },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      })
      invoiceId = invoice?.id ?? null
      expect(await manualSaleCount(prisma)).toBe(salesBefore + 1)
      expect(invoice?.amountCents).toBe(3200)
      expect(invoice?.lines.map(l => `${l.description} ×${l.quantity}`).sort()).toEqual(
        [`${lead.name} ×1`, `${treats.name} ×3`].sort(),
      )
    } finally {
      if (invoiceId) {
        await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } }).catch(() => {})
        await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {})
      }
      for (const id of made) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('the cart row removes cleanly and “−” stops at one', async ({ page }) => {
    const prisma = await makePrisma()
    const made: string[] = []
    try {
      const [toy] = await makeProducts(prisma, [`E2E Toy ${Date.now()}`])
      made.push(toy.id)

      await loginOwner(page)
      await enableInstantSale(page)
      await openComposer(page)
      const dialog = page.getByRole('dialog', { name: 'New sale' })

      await dialog.getByLabel('Search clients or dogs').fill('Sarah')
      await dialog.getByRole('button', { name: new RegExp(SEED.client.name) }).first().click()
      await dialog.getByRole('button', { name: `Add ${toy.name}` }).click()

      // At one, "−" is inert: losing a line by over-tapping minus is what the
      // bin-that-used-to-be-a-minus made possible.
      const minus = dialog.getByRole('button', { name: `One fewer ${toy.name}` })
      await expect(minus).toBeDisabled()
      await dialog.getByRole('button', { name: `One more ${toy.name}` }).click()
      await expect(minus).toBeEnabled()
      await minus.click()
      await expect(dialog.getByLabel(`Quantity of ${toy.name}`)).toHaveText('1')

      // Removal is its own button, and it empties the cart.
      await dialog.getByRole('button', { name: `Remove ${toy.name}` }).click()
      await expect(dialog.getByLabel(`Quantity of ${toy.name}`)).toHaveCount(0)
      // With nothing in it, there's no step forward.
      await expect(dialog.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
    } finally {
      for (const id of made) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a big catalogue gets a search box; a small one does not', async ({ page }) => {
    const prisma = await makePrisma()
    const made: string[] = []
    try {
      const before = await existingSellableCount(prisma)

      await loginOwner(page)
      await enableInstantSale(page)
      await openComposer(page)
      const dialog = page.getByRole('dialog', { name: 'New sale' })
      await dialog.getByLabel('Search clients or dogs').fill('Sarah')
      await dialog.getByRole('button', { name: new RegExp(SEED.client.name) }).first().click()

      const search = dialog.getByLabel('Search products')
      // Whether the box should be there is a function of the catalogue size, so
      // assert against the real count rather than assuming an empty database.
      await expect(dialog.getByRole('heading', { name: 'What are they buying?' })).toBeVisible()
      await expect(search).toHaveCount(before > PRODUCT_SEARCH_THRESHOLD ? 1 : 0)

      // Now push it over the line and reopen.
      const stamp = `${Date.now()}`
      const names = Array.from({ length: PRODUCT_SEARCH_THRESHOLD + 1 }, (_, i) => `E2E Bulk ${stamp} ${i}`)
      const rows = await makeProducts(prisma, names)
      made.push(...rows.map(r => r.id))
      const needle = rows[0].name

      await openComposer(page)
      await dialog.getByLabel('Search clients or dogs').fill('Sarah')
      await dialog.getByRole('button', { name: new RegExp(SEED.client.name) }).first().click()

      await expect(search).toBeVisible()
      await search.fill(needle)
      await expect(dialog.getByRole('button', { name: `Add ${needle}` })).toBeVisible()
      await expect(dialog.getByRole('button', { name: `Add ${rows[1].name}` })).toHaveCount(0)

      // A search that matches nothing says so rather than showing an empty grid.
      await search.fill('zzz no such product zzz')
      await expect(dialog.getByText(/Nothing matches/)).toBeVisible()
    } finally {
      for (const id of made) await prisma.product.delete({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
