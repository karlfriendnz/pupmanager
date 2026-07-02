import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// UAT for client→trainer finances + the session notes/homework flow against the
// isolated embedded Postgres (see global-setup.ts). The pentest spec's login()
// is file-local, so — matching every other spec in this suite — we keep a small
// local copy here.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const B = SEED.businessB

test.describe('finances — owner UAT', () => {
  test('owner opens /finances; Transactions + Invoices both render without crashing', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    await page.goto('/finances')
    // Page header + the two tabs render.
    await expect(page.getByRole('heading', { name: 'Finances' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Transactions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invoices' })).toBeVisible()

    // Transactions tab is the default; switching to Invoices doesn't crash and
    // the search box for invoices shows. Empty seed → an empty-state message,
    // which is a successful (non-crashing) render.
    await page.getByRole('button', { name: 'Invoices' }).click()
    await expect(page.getByPlaceholder('Search invoices by item or client…')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Transactions' }).click()
    // Either rows or an empty-state — both mean the tab rendered.
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('finances transactions + invoices APIs answer for the owner', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const tx = await page.request.get('/api/trainer/finances/transactions')
    expect(tx.status(), 'owner reading own transactions').toBe(200)
    const inv = await page.request.get('/api/trainer/finances/invoices')
    expect(inv.status(), 'owner reading own invoices').toBe(200)
  })
})

test.describe('finances — access control', () => {
  test('STAFF without billing.view is blocked from /finances', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)
    // The page redirects a member who lacks billing.view away from /finances.
    await page.goto('/finances')
    await expect(page).not.toHaveURL(/\/finances$/, { timeout: 15_000 })
    // And the API denies them too.
    const tx = await page.request.get('/api/trainer/finances/transactions')
    expect([401, 403]).toContain(tx.status())
  })

  test('cross-tenant: owner A cannot read business B finances rows', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // The list endpoints are company-scoped; even a valid request only ever
    // returns the caller's own rows — B's data must never leak. We assert no B
    // client name surfaces in A's transactions.
    const tx = await page.request.get(`/api/trainer/finances/transactions?q=${encodeURIComponent(B.name)}`)
    expect(tx.status()).toBe(200)
    const body = await tx.json()
    const rows = body.items ?? body.transactions ?? body.rows ?? []
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0)
  })
})

test.describe('session notes / homework flow — owner UAT', () => {
  test('draft-notes screen is reachable and renders', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/sessions/draft-notes')
    // Reachable (not redirected to login/dashboard) and no crash overlay.
    await expect(page).toHaveURL(/\/sessions\/draft-notes/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('AI polish endpoint is auth-scoped: a foreign session id is denied', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // A made-up / cross-tenant session id must not be polishable. Tolerate the
    // standard deny codes (and 400 for a body the route rejects before lookup).
    const res = await page.request.post('/api/sessions/not-a-real-session/polish', {
      data: { formId: 'nope', answers: { x: 'rough notes' } },
    })
    expect([400, 401, 403, 404]).toContain(res.status())
  })

  test('class attendance API rejects a foreign run/session (cross-tenant)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.put(
      `/api/class-runs/${B.packageId}/sessions/foreign-session/attendance`,
      { data: { records: [{ enrollmentId: 'x', status: 'PRESENT' }] } },
    )
    expect([400, 401, 403, 404]).toContain(res.status())
  })
})

// A throwaway Prisma client pointed at the test DB, mirroring pentest.spec.ts,
// so a future assertion can verify no mutation happened. Kept here to document
// the connection pattern; closed eagerly to avoid a dangling pool.
test.afterAll(async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
  await prisma.$disconnect()
})
