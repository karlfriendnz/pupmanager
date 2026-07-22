import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// End-to-end for the payment-agnostic invoicing flow (assign → receivable →
// Finances + client profile, edit line items, partial-payment display, and the
// cross-tenant guard) against the isolated embedded Postgres (see global-setup).
// Fixtures are seeded there under SEED.invoicing.
//
// Matching every other spec in this suite, login() is file-local.
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const INV = SEED.invoicing
const futureIso = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

test.describe('invoicing — assign a priced package raises a receivable', () => {
  test('"Create an invoice" → invoice appears in Finances and on the client profile', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Assign the priced package WITHOUT "already invoiced" → the route raises a
    // receivable via createInvoiceForAssignment. (Driving the real API + then
    // asserting the real UI; the availability picker isn't what's under test.)
    const res = await page.request.post(`/api/clients/${SEED.assignedClientId}/packages`, {
      data: { packageId: INV.pricedPackageId, sessionDates: [futureIso()], notify: false },
    })
    expect(res.status(), 'assign priced package').toBe(201)

    // The receivable exists for this client (company-scoped list API).
    const list = await page.request.get(`/api/trainer/finances/receivables?clientId=${SEED.assignedClientId}`)
    expect(list.status()).toBe(200)
    const items: Array<{ description: string; status: string }> = (await list.json()).items
    expect(items.some(i => i.description === 'Priced Puppy Course' && i.status === 'UNPAID')).toBe(true)

    // Finances → Invoices (the receivables tab is the default) shows it.
    await page.goto('/finances')
    await expect(page.getByRole('heading', { name: 'Finances' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('row', { name: /Priced Puppy Course/ })).toBeVisible({ timeout: 15_000 })

    // Client profile → Overview "Unpaid invoices" card shows it…
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(page.getByRole('heading', { name: 'Unpaid invoices' })).toBeVisible({ timeout: 15_000 })
    // The card is a tickable list (so several can be combined into one bill),
    // not a table — hence listitem rather than row.
    await expect(page.getByRole('listitem').filter({ hasText: 'Priced Puppy Course' }).first())
      .toBeVisible({ timeout: 15_000 })

    // …and the client's Invoices tab (still a table) lists it too.
    await page.getByRole('button', { name: 'Invoices' }).click()
    await expect(page.getByRole('row', { name: /Priced Puppy Course/ })).toBeVisible({ timeout: 15_000 })
  })

  test('"Already invoiced" (markInvoiced) creates NO receivable', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Assign to the (invoice-free) unassigned client WITH markInvoiced → skip.
    const res = await page.request.post(`/api/clients/${SEED.unassignedClientId}/packages`, {
      data: { packageId: INV.pricedPackageId, sessionDates: [futureIso()], notify: false, markInvoiced: true },
    })
    expect(res.status()).toBe(201)

    // No receivable was raised for this client.
    const list = await page.request.get(`/api/trainer/finances/receivables?clientId=${SEED.unassignedClientId}`)
    expect(list.status()).toBe(200)
    expect((await list.json()).items.length).toBe(0)
  })
})

test.describe('invoicing — edit line items', () => {
  test('open an invoice, change a line amount, total updates, save persists', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    await page.goto('/finances')
    // Target the visible desktop <tr> (the mobile cards are display:none at this
    // viewport, so a bare getByText().first() would pick the hidden card).
    const row = page.getByRole('row', { name: /Editable Invoice/ })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByText('Editable Invoice').click() // bubbles to the row's open handler

    const dialog = page.getByRole('dialog', { name: 'Invoice' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    // Starts at the seeded $200.00.
    await expect(dialog.getByText('$200.00').first()).toBeVisible()

    await dialog.getByRole('button', { name: 'Edit' }).click()
    // In edit mode a line has two number inputs: [quantity, unit]. Bump the unit.
    const numberInputs = dialog.locator('input[type="number"]')
    await numberInputs.nth(1).fill('250')
    // Total recomputes live.
    await expect(dialog.getByText('$250.00').first()).toBeVisible()

    await dialog.getByRole('button', { name: 'Save' }).click()
    // Back in the read view, the new total is persisted.
    await expect(dialog.getByText('$250.00').first()).toBeVisible({ timeout: 10_000 })

    // And the list API reflects the new amount.
    const detail = await page.request.get(`/api/trainer/finances/receivables/${INV.editableInvoiceId}`)
    expect(detail.status()).toBe(200)
    expect((await detail.json()).amountCents).toBe(25000)
  })
})

test.describe('invoicing — partial payment display', () => {
  test('a PARTIAL invoice shows "Partially paid" + "paid $X of $Y" on the client profile', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    await page.goto(`/clients/${SEED.assignedClientId}`)
    await page.getByRole('button', { name: 'Invoices' }).click()

    await expect(page.getByText('Half-Paid Course').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Partially paid').first()).toBeVisible()
    await expect(page.getByText('paid $150.00 of $380.00').first()).toBeVisible()
  })
})

test.describe('invoicing — cross-tenant guard', () => {
  test('a second trainer cannot load the first trainer’s invoice detail (404)', async ({ page }) => {
    // Business B owner tries to read Business A's invoice by id.
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    const res = await page.request.get(`/api/trainer/finances/receivables/${INV.partialInvoiceId}`)
    expect(res.status()).toBe(404)
  })

  test('and the reverse: trainer A cannot load trainer B’s invoice detail (404)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.get(`/api/trainer/finances/receivables/${INV.businessBInvoiceId}`)
    expect(res.status()).toBe(404)
  })
})
