import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Regression: a customer typed a real address ("37 Northside Drive, Invercargill")
// on the New client form but Google offered no matching suggestion to tap, so the
// address widget handed nothing back to the form and the server rejected the
// create with "Address is required". The fix has the address box report typed
// text even when no dropdown option is picked. These specs prove a hand-typed
// address survives create (coords stay empty until geocoded — never lost).
//
// CI-safe: the free-text path runs entirely client-side and does not depend on
// the Google Maps script loading, so no Maps API key is needed.

void TEST_DATABASE_URL

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('New client — typed address (no dropdown pick)', () => {
  test('a hand-typed address is captured and persisted on create', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients/invite')

    const name = `Ange Webb ${Date.now()}`
    const typedAddress = '37 Northside Drive, Invercargill'

    await page.getByPlaceholder('Jane Smith').fill(name)
    // This seed's trainer requires a "Training goals" custom field (same as the
    // customer's setup) — satisfy it so only the address behaviour is under test.
    await page.locator('label:has-text("Training goals") ~ textarea').fill('Loose-lead walking')
    // Type the address but deliberately never select a Google suggestion —
    // exactly the customer's flow.
    await page.getByPlaceholder('Search address…').fill(typedAddress)

    await page.getByRole('button', { name: 'Create client' }).click()

    // The old bug surfaced "Address is required" and kept the form open.
    await expect(page.getByText(/Address is required/i)).toHaveCount(0)

    // Success redirects to the new client's page: /clients/<id> (not /invite).
    await page.waitForURL(
      (url) => /\/clients\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/invite'),
      { timeout: 30_000 },
    )
    const clientId = page.url().split('/clients/')[1].split(/[?#]/)[0]
    expect(clientId).toBeTruthy()

    // Persisted: the edit form pre-fills the address box from the DB, so its
    // value proves the typed text reached the server and was stored.
    await page.goto(`/clients/${clientId}/edit`)
    // The address field lives under the "Details" tab (default tab is Dogs).
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByPlaceholder('Search address…')).toHaveValue(typedAddress)
  })

  test('editing to a new hand-typed address persists on blur', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Create a client to edit (typed address, no pick).
    await page.goto('/clients/invite')
    await page.getByPlaceholder('Jane Smith').fill(`Edit Addr ${Date.now()}`)
    await page.locator('label:has-text("Training goals") ~ textarea').fill('Recall')
    await page.getByPlaceholder('Search address…').fill('12 First Street, Gore')
    await page.getByRole('button', { name: 'Create client' }).click()
    await page.waitForURL(
      (url) => /\/clients\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/invite'),
      { timeout: 30_000 },
    )
    const clientId = page.url().split('/clients/')[1].split(/[?#]/)[0]

    // On the edit form, type a *different* address and never pick a suggestion.
    const newAddress = '99 Second Avenue, Queenstown'
    await page.goto(`/clients/${clientId}/edit`)
    await page.getByRole('button', { name: 'Details' }).click()
    const addr = page.getByPlaceholder('Search address…')
    await addr.fill(newAddress)
    // Blur the field (click another input) so the on-blur persistence fires,
    // and wait for the location PATCH to complete.
    const patch = page.waitForResponse(
      (r) => r.url().includes(`/clients/${clientId}/location`) && r.request().method() === 'PATCH' && r.ok(),
      { timeout: 15_000 },
    )
    await page.getByPlaceholder('+64 21 555 0100').click()
    await patch

    // Reload — the new typed address must have persisted (old behaviour dropped
    // it because nothing was picked from the dropdown).
    await page.goto(`/clients/${clientId}/edit`)
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByPlaceholder('Search address…')).toHaveValue(newAddress)
  })
})
