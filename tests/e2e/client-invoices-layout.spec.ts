import { test, expect, type Page, type Locator } from '@playwright/test'
import { SEED } from './test-db'

// The client profile's Invoices tab, at phone width.
//
// It was the same defect the Finances list had and the same fix: a 4-column
// table whose untruncated description wrapped badly, inside a Card, inside the
// page's own p-4 wrapper — ~33px of dead margin down both edges of a 390px
// screen while the description ran to three ragged lines. The two lists show
// the same rows and must now read alike, so this mirrors
// finances-list-layout.spec.ts and measures rather than asserting class names.
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const INV = SEED.invoicing

async function rightEdges(loc: Locator): Promise<number[]> {
  const boxes = await Promise.all((await loc.all()).map(l => l.boundingBox()))
  return boxes.map(b => {
    expect(b, 'element should be laid out').not.toBeNull()
    return Math.round((b!.x + b!.width) * 10) / 10
  })
}

/** Open the assigned client's Invoices page — a route of its own since the
 *  profile's tabs became pages. */
async function openClientInvoices(page: Page) {
  await page.goto(`/clients/${SEED.assignedClientId}/invoices`)
  await expect(page.getByTestId('client-invoice-row').first()).toBeVisible({ timeout: 20_000 })
}

test.describe('client profile → Invoices — the cramped table is gone', () => {
  test('at 390px the rows use the full width of the phone', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openClientInvoices(page)

    const row = page.getByTestId('client-invoice-row').first()
    const box = (await row.boundingBox())!
    expect(Math.round(box.x), 'the row starts at the screen edge').toBeLessThanOrEqual(1)
    expect(Math.round(box.width), 'the row spans the phone').toBeGreaterThanOrEqual(PHONE.width - 1)

    // Nothing wraps or runs off the edge, at any row.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(0)
  })

  test('at 390px the description truncates to one line and the money column lines up', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openClientInvoices(page)

    const rows = page.getByTestId('client-invoice-row')
    const rowCount = await rows.count()
    expect(rowCount, 'need several rows to prove a column').toBeGreaterThan(2)

    // The long-description fixture is exactly the row that used to wrap. Its
    // description is clipped to a single line…
    const longRow = rows.filter({ hasText: INV.longTitleInvoiceDescription.slice(0, 24) })
    await expect(longRow).toHaveCount(1)
    const desc = longRow.getByTestId('client-invoice-desc')
    const clipped = await desc.evaluate(el => ({
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
      truncated: el.scrollWidth > el.clientWidth,
    }))
    expect(clipped.lines, 'the description is one line, not three').toBe(1)
    expect(clipped.truncated, 'and it is genuinely clipped, not just short').toBe(true)

    // …so the row is no taller than one with a short description.
    const longBox = (await longRow.boundingBox())!
    const shortBox = (await rows.filter({ hasText: 'Editable Invoice' }).first().boundingBox())!
    expect(longBox.height, 'a long description must not make a taller row')
      .toBeLessThan(shortBox.height + 8)

    // Every amount shares one right edge, including the four-figure one —
    // the money column is fixed-width, so the description can't push it about.
    const amountEdges = await rightEdges(page.getByTestId('client-invoice-amount'))
    expect(amountEdges).toHaveLength(rowCount)
    expect(new Set(amountEdges).size, `amounts staggered: ${amountEdges.join(', ')}`).toBe(1)

    // And the description column actually got the freed-up space.
    const rowBox = (await rows.first().boundingBox())!
    const amountBox = (await page.getByTestId('client-invoice-amount').first().boundingBox())!
    expect(amountBox.x - rowBox.x, 'the description column is no longer squeezed').toBeGreaterThan(220)
  })

  test('at 1440px it is still a table, with the columns bounded', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}/invoices`)

    const rows = page.getByTestId('client-invoice-row-desktop')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    expect(await rows.count()).toBeGreaterThan(2)

    // The long description is bounded and truncated rather than stretching the
    // table and shoving the amount/status columns sideways.
    const cell = rows.filter({ hasText: INV.longTitleInvoiceDescription.slice(0, 24) }).locator('td').nth(1)
    const cellBox = (await cell.boundingBox())!
    expect(cellBox.width, 'the description column is capped').toBeLessThanOrEqual(26 * 16 + 40)
  })

  test('the Unpaid filter narrows the list without losing the layout', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openClientInvoices(page)

    const all = await page.getByTestId('client-invoice-row').count()
    await page.getByRole('button', { name: 'Unpaid' }).click()
    const unpaid = await page.getByTestId('client-invoice-row').count()
    expect(unpaid).toBeGreaterThan(0)
    expect(unpaid, 'the paid fixture drops out').toBeLessThan(all)

    // Still edge to edge, still no sideways scroll.
    const box = (await page.getByTestId('client-invoice-row').first().boundingBox())!
    expect(Math.round(box.x)).toBeLessThanOrEqual(1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('cross-tenant guard', () => {
  test('another trainer cannot open this client at all', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    const res = await page.request.get(`/clients/${SEED.assignedClientId}`)
    expect(res.status()).toBe(404)
  })
})
