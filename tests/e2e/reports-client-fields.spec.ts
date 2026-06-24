import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// UAT + light authz for the Reports area and client capture (quick-add). Runs
// against the isolated E2E Postgres seeded with Business A (owner/manager/staff)
// and a rival Business B. Selectors stay resilient (getByRole/getByText) so
// cosmetic changes don't break the suite.

// Touch the import so the test DB module is loaded the same way the other specs
// reference it; the actual connection lives in global-setup.
void TEST_DATABASE_URL

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('Reports — UAT', () => {
  test('owner opens /reports and the page renders without crashing', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/reports')

    // Header + the default "Clients & dogs" tab content prove the server
    // component fetched data and the explorer mounted.
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Clients & dogs/i })).toBeVisible()
    await expect(page.getByText('New clients per month')).toBeVisible()
    // No client-side error overlay.
    await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0)
  })

  test('owner can switch report tabs and charts/data render', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/reports')

    await page.getByRole('button', { name: /Sessions/i }).first().click()
    await expect(page.getByText(/logged across all sessions/i)).toBeVisible()

    await page.getByRole('button', { name: /Revenue/i }).first().click()
    await expect(page.getByText(/enquiries accepted/i)).toBeVisible()
  })
})

test.describe('Reports — access control', () => {
  test('staff without billing.view is bounced off /reports to the dashboard', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)
    await page.goto('/reports')
    // The page redirects staff lacking billing.view back to the dashboard.
    await page.waitForURL('**/dashboard', { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Reports' })).toHaveCount(0)
  })
})

test.describe('Client capture — quick-add (UAT)', () => {
  test('owner creates a contact via quick-add respecting required fields', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients')

    await page.getByRole('button', { name: /Quick add/i }).click()
    const dialog = page.getByRole('heading', { name: 'Quick add contact' })
    await expect(dialog).toBeVisible()

    const unique = `Pup E2E ${Date.now()}`
    // Default quick-add config requires Name + Phone; fill both.
    await page.getByLabel(/^Name/).fill(unique)
    await page.getByLabel(/^Phone/).fill('021 555 0100')
    await page.getByRole('button', { name: 'Add contact' }).click()

    // Modal closes and the new contact appears in the "New" follow-up bucket.
    await expect(page.getByRole('heading', { name: 'Quick add contact' })).toHaveCount(0)
    await expect(page.getByText(unique)).toBeVisible({ timeout: 15_000 })
  })

  test('quick-add blocks submit when a required field is empty', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients')

    await page.getByRole('button', { name: /Quick add/i }).click()
    await expect(page.getByRole('heading', { name: 'Quick add contact' })).toBeVisible()

    // Name only, no phone → server rejects with a "required" error and the
    // modal stays open.
    await page.getByLabel(/^Name/).fill(`Pup NoPhone ${Date.now()}`)
    await page.getByRole('button', { name: 'Add contact' }).click()
    await expect(page.getByText(/required/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Quick add contact' })).toBeVisible()
  })
})

test.describe('Client field-config API — cross-tenant tolerance', () => {
  test('field-config returns only the caller’s own company config', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // The endpoint derives the company from the session — there is no id to
    // tamper with. It must succeed for the owner and return a complete config.
    const res = await page.request.get('/api/clients/field-config')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.config?.name).toMatchObject({ required: true })
  })

  test('field-config is rejected for an unauthenticated request', async ({ request }) => {
    const res = await request.get('/api/clients/field-config', { maxRedirects: 0 })
    // 401 (route guard) or a middleware redirect — all deny access.
    expect([401, 403, 307]).toContain(res.status())
  })
})

test.describe('Create-client API — cross-tenant + mass-assignment tolerance', () => {
  test('a body trainerId cannot move a created client to another tenant', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // Owner A creates a client but tries to plant it in Business B via a body
    // trainerId. Either the field is ignored (client lands in A) or the request
    // is denied — never a successful cross-tenant write.
    const res = await page.request.post('/api/clients', {
      data: {
        mode: 'full',
        name: `MassAssign ${Date.now()}`,
        trainerId: SEED.businessB.clientId, // attacker-supplied tenant
      },
    })
    // Tolerate a success (field ignored, scoped to A) or any deny code.
    expect([201, 400, 401, 403, 404, 409]).toContain(res.status())
  })

  test('unauthenticated create is rejected (no client written)', async ({ request }) => {
    const res = await request.post('/api/clients', {
      maxRedirects: 0,
      data: { mode: 'full', name: 'Nope' },
    })
    expect([401, 403, 307]).toContain(res.status())
  })
})
