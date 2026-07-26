import { test, expect, type Page, type Locator } from '@playwright/test'
import { SEED } from './test-db'

// Finances → Invoices / Transactions layout, reported from a phone:
//   1. the invoice rows' right-hand elements (amount, status badge, Xero icon)
//      each staggered to wherever the text before them ended;
//   2. the invoice document's five bordered buttons overflowed a 390px bar;
//   3. the payments rows restated the same figure a third time as
//      "Card fee … Net …".
//
// Everything here is measured against the real seeded list rather than asserted
// by class name, so it fails if the columns drift again.
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
const PAY = SEED.payments

// Right edge of every matching element, in page pixels.
async function rightEdges(loc: Locator): Promise<number[]> {
  const boxes = await Promise.all((await loc.all()).map(l => l.boundingBox()))
  return boxes.map(b => {
    expect(b, 'element should be laid out').not.toBeNull()
    return Math.round((b!.x + b!.width) * 10) / 10
  })
}

async function openFinances(page: Page) {
  await page.goto('/finances')
  // Anchor on the invoices search box, not the page title: on a phone the
  // trainer shell's top bar owns the title, so there is no "Finances" heading.
  await expect(page.getByPlaceholder(/Search invoices/)).toBeVisible({ timeout: 20_000 })
  // The "take card payments" nudge can sit over the list on a fresh trainer.
  const notNow = page.getByRole('button', { name: 'Not now' })
  if (await notNow.isVisible().catch(() => false)) await notNow.click()
}

test.describe('Finances → Invoices — the list columns line up', () => {
  test('at 390px every amount, badge and Xero slot shares a column', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)

    const rows = page.getByTestId('rcv-row')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    const rowCount = await rows.count()
    // The seed alone gives several invoices; the alignment claim is meaningless
    // with one row.
    expect(rowCount, 'need several rows to prove a column').toBeGreaterThan(2)

    // Amounts share a right edge…
    const amountEdges = await rightEdges(page.getByTestId('rcv-amount'))
    expect(amountEdges).toHaveLength(rowCount)
    expect(new Set(amountEdges).size, `amounts staggered: ${amountEdges.join(', ')}`).toBe(1)

    // …so do the badges, even though their labels ("Sent", "Unsent",
    // "Partially paid", "Paid") are all different widths. That difference is
    // exactly what used to push them out of line.
    const badges = page.getByTestId('rcv-badge')
    const badgeEdges = await rightEdges(badges)
    expect(badgeEdges).toHaveLength(rowCount)
    expect(new Set(badgeEdges).size, `badges staggered: ${badgeEdges.join(', ')}`).toBe(1)
    const badgeLabels = await badges.allInnerTexts()
    expect(new Set(badgeLabels).size, 'labels should differ in width').toBeGreaterThan(1)

    // The Xero slot is reserved on EVERY row — including the rows with no icon,
    // which used to let the amount/badge slide right.
    const slots = page.getByTestId('rcv-xero-slot')
    await expect(slots).toHaveCount(rowCount)
    const slotBoxes = await Promise.all((await slots.all()).map(s => s.boundingBox()))
    const slotLefts = slotBoxes.map(b => Math.round(b!.x * 10) / 10)
    expect(new Set(slotLefts).size, `xero slots staggered: ${slotLefts.join(', ')}`).toBe(1)
    expect(new Set(slotBoxes.map(b => Math.round(b!.width))).size).toBe(1)

    // …and the list genuinely mixes synced and unsynced rows.
    const xeroLinks = page.getByTestId('rcv-xero-slot').getByRole('link', { name: 'View in Xero' })
    const synced = await xeroLinks.count()
    expect(synced, 'at least one row is synced to Xero').toBeGreaterThan(0)
    expect(synced, 'and at least one row is not').toBeLessThan(rowCount)

    // A long title truncates instead of shoving the columns sideways: the row
    // carrying it keeps the same amount edge as everything else, and the page
    // never scrolls sideways.
    const longRow = rows.filter({ hasText: INV.longTitleInvoiceDescription.slice(0, 24) })
    await expect(longRow).toHaveCount(1)
    const longEdge = await rightEdges(longRow.getByTestId('rcv-amount'))
    expect(longEdge[0]).toBe(amountEdges[0])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(0)
  })

  test('at 390px the rows use the full width of the phone', async ({ page }) => {
    // The page padding + the block's side border + the row padding stacked up
    // to ~33px of dead margin down both edges, so titles truncated to
    // "Bayfair (drop-in · se…" with the screen edges empty. The list block now
    // goes edge to edge; only the row's own 16px padding remains.
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)

    const row = page.getByTestId('rcv-row').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    const box = (await row.boundingBox())!
    expect(Math.round(box.x), 'the row starts at the screen edge').toBeLessThanOrEqual(1)
    expect(Math.round(box.width), 'the row spans the phone').toBeGreaterThanOrEqual(PHONE.width - 1)

    // …and the title column actually got the space: the gap between the row's
    // left edge and where the money column begins is the row padding alone.
    const amountBox = (await row.getByTestId('rcv-amount').boundingBox())!
    const titleWidth = amountBox.x - box.x
    expect(titleWidth, 'the title column is no longer squeezed').toBeGreaterThan(220)

    // Still no sideways scroll.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(0)
  })

  test('at 1440px the desktop table keeps the same columns', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)

    const rows = page.getByTestId('rcv-row-desktop')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    const amountEdges = await rightEdges(page.getByTestId('rcv-amount-cell'))
    expect(amountEdges.length).toBeGreaterThan(2)
    expect(new Set(amountEdges).size, `desktop amounts staggered: ${amountEdges.join(', ')}`).toBe(1)

    // Badges are left-aligned in their own column on desktop.
    const badgeBoxes = await Promise.all(
      (await page.getByTestId('rcv-badge-cell').all()).map(b => b.boundingBox()),
    )
    const lefts = badgeBoxes.map(b => Math.round(b!.x * 10) / 10)
    expect(new Set(lefts).size, `desktop badges staggered: ${lefts.join(', ')}`).toBe(1)
  })
})

test.describe('the invoice document action bar fits a phone', () => {
  // Opens the seeded UNPAID + unsent invoice, which offers every action.
  async function openEditableInvoice(page: Page) {
    await openFinances(page)
    await page.getByTestId('rcv-row').filter({ hasText: 'Editable Invoice' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Invoice', exact: true })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    return dialog
  }

  test('at 390px the bar is one row: close and More, nothing else', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    const dialog = await openEditableInvoice(page)

    const bar = page.getByTestId('invoice-action-bar')
    const barBox = (await bar.boundingBox())!
    // Five bordered buttons wrapped onto three lines here; one row is ~56px.
    expect(barBox.height, 'the action bar must not wrap').toBeLessThan(64)

    // Send/Resend moved into the sheet with everything else, so the header is
    // the same clean row on every invoice: close, the title, More.
    const more = bar.getByRole('button', { name: 'More' })
    await expect(more).toBeVisible()
    await expect(bar.getByRole('button', { name: /^(Send|Resend)$/ })).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Print' })).toHaveCount(0)
    await expect(bar.getByRole('button')).toHaveCount(2) // Close + More

    // Nothing runs off the screen edge.
    const dialogBox = (await dialog.boundingBox())!
    for (const b of await bar.getByRole('button').all()) {
      const box = (await b.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(dialogBox.x - 1)
      expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1)
    }
  })

  test('More opens a sheet holding every action, and closes cleanly', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    const dialog = await openEditableInvoice(page)

    await page.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'Invoice actions' })
    await expect(sheet).toBeVisible()

    // No action was dropped — including the send, which used to be the one
    // button the header kept for itself.
    await expect(sheet.getByRole('button', { name: /^(Send|Resend) to the client/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Edit invoice' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Copy pay link' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Record a payment' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible()

    // It's a sheet, not a 56px menu in a corner: full width off the bottom edge.
    const sheetBox = (await sheet.boundingBox())!
    expect(sheetBox.width).toBeGreaterThan(PHONE.width * 0.9)

    // Body scroll is locked while it's open — never two scrollbars.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    // Escape closes the sheet and leaves the invoice open behind it.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(dialog).toBeVisible()

    // Outside click closes it too.
    await page.getByRole('button', { name: 'More' }).click()
    await expect(sheet).toBeVisible()
    await page.mouse.click(PHONE.width / 2, 60)
    await expect(sheet).toBeHidden()
    await expect(dialog).toBeVisible()
  })

  test('Copy pay link still confirms it copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openEditableInvoice(page)

    await page.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'Invoice actions' })
    await sheet.getByRole('button', { name: 'Copy pay link' }).click()

    // The confirmation shows in place rather than being swallowed by the menu
    // closing, and the real pay link lands on the clipboard.
    await expect(sheet.getByRole('button', { name: 'Copied' })).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(`/pay/${INV.editableInvoicePayToken}`)
  })

  test('a settled invoice offers Print in the sheet and never Send', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)

    await page.getByTestId('rcv-row').filter({ hasText: 'Puppy Starter Pack' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Invoice', exact: true })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const bar = page.getByTestId('invoice-action-bar')
    expect((await bar.boundingBox())!.height).toBeLessThan(64)

    await bar.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'Invoice actions' })
    await expect(sheet.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^(Send|Resend) to the client/ })).toHaveCount(0)
  })

  test('a Xero-synced invoice offers View in Xero from the sheet', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)

    // The long-title fixture is the seeded row that reached Xero.
    const syncedRow = page.getByTestId('rcv-row').filter({ hasText: INV.longTitleInvoiceDescription.slice(0, 24) })
    await expect(syncedRow).toHaveCount(1, { timeout: 20_000 })
    await syncedRow.click()
    await expect(page.getByRole('dialog', { name: 'Invoice', exact: true })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'Invoice actions' })
    await expect(sheet.getByRole('button', { name: 'View in Xero' })).toBeVisible()
  })
})

test.describe('Finances → Transactions — the card fee / net line is gone', () => {
  test('the row shows the amount and status only; the breakdown is in the detail', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await openFinances(page)
    await page.getByRole('button', { name: 'Transactions' }).click()

    const row = page.getByTestId('tx-row').filter({ hasText: PAY.plainDescription })
    await expect(row).toHaveCount(1, { timeout: 20_000 })
    await expect(row.getByTestId('tx-amount')).toHaveText('$90.00')
    await expect(row.getByTestId('tx-badge')).toHaveText('Paid')
    // The third line the trainer asked to lose.
    await expect(row.getByText(/Card fee/)).toHaveCount(0)
    await expect(row.getByText(/Net/)).toHaveCount(0)

    // Rows still line up.
    const amountEdges = await rightEdges(page.getByTestId('tx-amount'))
    expect(amountEdges.length).toBeGreaterThan(1)
    expect(new Set(amountEdges).size, `tx amounts staggered: ${amountEdges.join(', ')}`).toBe(1)

    // The fee and the net are still calculated — they moved, they weren't cut.
    await row.click()
    const detail = page.getByRole('dialog')
    await expect(detail.getByText('Card fee')).toBeVisible()
    await expect(detail.getByText('− $2.91')).toBeVisible()
    await expect(detail.getByText('Net to you')).toBeVisible()
    await expect(detail.getByText('$87.09')).toBeVisible()
  })
})

test.describe('cross-tenant guard', () => {
  test('a second trainer’s Finances shows none of the first trainer’s invoices', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    await openFinances(page)

    await expect(page.getByTestId('rcv-row').filter({ hasText: 'Editable Invoice' })).toHaveCount(0)
    await expect(page.getByText(INV.longTitleInvoiceDescription)).toHaveCount(0)
    // And the transaction fixtures belong to Business A only.
    await page.getByRole('button', { name: 'Transactions' }).click()
    await expect(page.getByTestId('tx-row').filter({ hasText: PAY.plainDescription })).toHaveCount(0)
  })
})
