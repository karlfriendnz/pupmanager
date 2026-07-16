import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The dog owner's own invoice list (/my-invoices). Before this page an invoice
// only reached the client as an emailed /pay/<token> link — lose the email, lose
// the ability to pay. Fixtures live in global-setup: the seeded client
// (SEED.client) owns Business A's PARTIAL "Half-Paid Course" and UNPAID
// "Editable Invoice" (fixed pay token), and Business A passes the card fee on.
//
// Matching every other spec in this suite, login() is file-local.
async function login(page: Page, email: string, password: string, landing: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`**${landing}`, { timeout: 30_000 })
  await passIntakeGate(page)
  // The client app greets a first-time visitor with the "Get the app" modal,
  // which sits over the nav — dismiss it so clicks land.
  const maybeLater = page.getByRole('button', { name: 'Maybe later' })
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click()
}

// The (client) layout gates the whole app behind intake until every REQUIRED
// field has a value. Other specs add required fields to Business A, so whether
// the gate appears depends on what ran before — fill it if it's there (which is
// what a real client does on their first visit) rather than depend on the order.
async function passIntakeGate(page: Page) {
  const gate = page.getByRole('heading', { name: 'Before you get started' })
  if (!(await gate.isVisible({ timeout: 5_000 }).catch(() => false))) return

  const required = page.locator('input[placeholder="Required"], select[required]')
  for (let i = 0; i < await required.count(); i++) {
    const field = required.nth(i)
    if ((await field.evaluate(el => el.tagName)) === 'SELECT') {
      await field.selectOption({ index: 1 }).catch(() => {})
    } else {
      await field.fill('E2E')
    }
  }
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(gate).toHaveCount(0, { timeout: 20_000 })
}

const INV = SEED.invoicing

test.describe('client invoices — the client can find and pay their invoice', () => {
  test('outstanding invoices are listed and link at the in-app invoice page', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password, '/home')

    // Reachable from the client nav (not just by typing the URL).
    // (sidebar on desktop + the mobile menu render the same entry — take either)
    await page.getByRole('link', { name: 'Invoices' }).first().click()
    await page.waitForURL('**/my-invoices', { timeout: 15_000 })

    // A simple list: each invoice, its status, paid or not.
    const unpaid = page.getByTestId(`invoice-${INV.editableInvoiceId}`)
    const partial = page.getByTestId(`invoice-${INV.partialInvoiceId}`)
    const settled = page.getByTestId(`invoice-${INV.paidInvoiceId}`)

    await expect(unpaid).toBeVisible({ timeout: 15_000 })
    await expect(unpaid.getByText('Editable Invoice')).toBeVisible()
    await expect(unpaid.getByText('Unpaid')).toBeVisible()

    await expect(partial.getByText('Half-Paid Course')).toBeVisible()
    await expect(partial.getByText('Part paid')).toBeVisible()

    // A settled invoice reads as a receipt: what they paid, when.
    await expect(settled.getByText('Puppy Starter Pack')).toBeVisible()
    await expect(settled.getByText('Paid', { exact: true })).toBeVisible()
    await expect(settled.getByText('Paid 4 May 2026')).toBeVisible()
    await expect(settled.getByText('$120.00')).toBeVisible()

    // Every row opens the invoice's own in-app page — /my-invoices/<payToken> —
    // so the client keeps the app shell (left menu / bottom tabs).
    await expect(unpaid).toHaveAttribute('href', `/my-invoices/${INV.editableInvoicePayToken}`)
  })

  test('tapping an invoice opens its detail, quoting the amount the pay page charges', async ({ page }) => {
    // The bug this guards: the card surcharge was only added at Stripe, so a
    // client read one number, clicked pay, and was asked for a bigger one. The
    // list, the detail page and Stripe must all say the same thing.
    await login(page, SEED.client.email, SEED.client.password, '/home')
    await page.goto('/my-invoices')

    const row = page.getByTestId(`invoice-${INV.editableInvoiceId}`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    // $200 invoice + NZD card surcharge — the list never quotes a bare $200.00.
    await expect(row.getByText('$200.00')).toHaveCount(0)
    const listed = (await row.innerText()).match(/\$[\d,]+\.\d{2}/)?.[0]
    expect(listed).toBeTruthy()

    // Tap through to the detail (the in-app invoice page).
    await row.click()
    await page.waitForURL(`**/my-invoices/${INV.editableInvoicePayToken}`, { timeout: 15_000 })

    // The detail shows the line items + the fee, and charges exactly what the
    // list quoted.
    await expect(page.getByText('Consult')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Card processing fee')).toBeVisible()
    await expect(page.getByRole('button', { name: `Pay ${listed}` })).toBeVisible()

    // The app shell is still there — the whole point of the in-app page. The
    // client can get back to the rest of the app without a browser back button.
    await expect(page.getByRole('link', { name: 'Invoices' }).first()).toBeVisible()
  })

  test('a client never sees another client’s or another trainer’s invoice', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password, '/home')
    await page.goto('/my-invoices')
    await expect(page.getByTestId(`invoice-${INV.editableInvoiceId}`)).toBeVisible({ timeout: 15_000 })

    // Business B's invoice belongs to a different client of a different trainer.
    await expect(page.getByText('Rival Invoice')).toHaveCount(0)
    await expect(page.getByTestId(`invoice-${INV.businessBInvoiceId}`)).toHaveCount(0)
  })

  test('signed-out visitors are bounced to login', async ({ page }) => {
    await page.goto('/my-invoices')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})
