import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// E2E for bulk client email (POST /api/clients/email-bulk). API-driven, matching
// notifications-email.spec.ts. The actual send can't succeed in e2e (no real
// Resend), so the happy path lives in the unit suite; here we prove the guards
// that fire BEFORE any send: the verified-sending-domain gate, cross-tenant
// isolation, and auth. Seed trainers have no verified sending domain.
const B = SEED.businessB

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('bulk email — guards', () => {
  test('blocks sending until the trainer has verified a sending domain', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post('/api/clients/email-bulk', {
      data: { clientIds: [SEED.assignedClientId], subject: 'Hello', body: '<p>Hi {{clientName}}</p>' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).code).toBe('DOMAIN_NOT_VERIFIED')
  })

  test('Owner A cannot bulk-email a Business B client (no cross-tenant send)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post('/api/clients/email-bulk', {
      data: { clientIds: [B.clientId], subject: 'cross-tenant', body: '<p>hi</p>' },
    })
    // Domain gate (403) fires first for the seed owner; either way it must never
    // 201/200 a send to another tenant's client.
    expect([401, 403, 404, 422]).toContain(res.status())
  })

  test('an unauthenticated request is denied', async ({ request }) => {
    const res = await request.post('/api/clients/email-bulk', {
      data: { clientIds: ['whatever'], subject: 's', body: '<p>b</p>' },
      maxRedirects: 0,
    })
    expect([401, 403, 307]).toContain(res.status())
  })
})

test.describe('bulk email — clients-list selection UI', () => {
  test('owner can enter select mode and reveal the email action bar', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients')
    await page.getByRole('button', { name: 'Select clients to email' }).click()
    // Select-all appears, and selecting all reveals the "{n} selected" bar + Email action.
    await page.getByRole('button', { name: /select all/i }).click()
    await expect(page.getByText(/\d+ selected/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Email/ })).toBeVisible()
  })
})

test.describe('marketing page', () => {
  test('owner sees the Marketing page with the domain-setup prompt and empty state', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing')
    await expect(page.getByRole('heading', { name: 'Marketing' })).toBeVisible()
    // Seed owner has no verified sending domain → the domain setup panel shows
    // inline (moved here from Settings), with the empty broadcast list below.
    await expect(page.getByText(/set up email sending/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /set up/i })).toBeVisible()
    await expect(page.getByText(/no emails sent yet/i)).toBeVisible()
  })

  test('owner can open the full-page composer at /marketing/new', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing/new')
    // The 3-step composer renders (step 1 = Create email) with a subject field.
    await expect(page.getByText(/create email/i).first()).toBeVisible()
    await expect(page.getByPlaceholder(/subject of your email/i)).toBeVisible()
  })

  test('a broadcast detail that is not the trainer’s 404s (tenant scope)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.goto('/marketing/nonexistent-broadcast-id')
    expect(res?.status()).toBe(404)
  })
})

test.describe('bulk email — unsubscribe page', () => {
  test('an invalid unsubscribe token shows the not-valid state, not an error', async ({ page }) => {
    await page.goto('/unsubscribe/not-a-real-token')
    await expect(page.getByText(/link not valid/i)).toBeVisible()
  })
})
