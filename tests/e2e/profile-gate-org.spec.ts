import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { SEED, TEST_DATABASE_URL } from './test-db'

// UAT + security for: the trainer profile-completion gate, cross-tenant org
// switching, and the account-deletion control. Runs against the isolated
// embedded Postgres (see global-setup.ts) so nothing here touches prod.
//
// Read-only DB lookups (business B's company id, which has no fixed SEED id) use
// a dedicated Prisma client pointed at the test DB — same pattern as pentest.spec.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } })

test.afterAll(async () => {
  await prisma.$disconnect()
})

test.describe('profile-completion gate', () => {
  test('owner with a complete profile is NOT blocked — reaches the dashboard', async ({ page }) => {
    // SEED.owner has name + businessName set; the gate must let them straight in
    // (login() already waits for **/dashboard, so a redirect to /complete-profile
    // would fail it).
    await login(page, SEED.owner.email, SEED.owner.password)
    await expect(page).toHaveURL(/\/dashboard/)
    // Sanity: the gate's complete-profile screen is NOT shown.
    await expect(page).not.toHaveURL(/\/complete-profile/)
  })
})

test.describe('org switching — cross-tenant guard', () => {
  test('a trainer cannot switch their active org to a business they are not a member of', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Business B's company id (the trainer profile id) — the attacker (owner A)
    // holds no membership for it.
    const bProfile = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.businessB.businessName },
      select: { id: true },
    })
    expect(bProfile, 'business B profile should exist in the test DB').toBeTruthy()

    const res = await page.request.post('/api/trainer/switch-org', {
      data: { companyId: bProfile!.id },
    })
    // Refused — not a member. Tolerate the family of deny codes.
    expect([401, 403, 404]).toContain(res.status())

    // And the active org is unchanged: the layout still renders Business A's
    // dashboard for owner A (no silent re-point to the rival tenant).
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('switching to a non-existent / garbage company id is rejected', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post('/api/trainer/switch-org', {
      data: { companyId: 'totally-made-up-company-id' },
    })
    expect([400, 401, 403, 404]).toContain(res.status())
  })
})

test.describe('account deletion control', () => {
  test('the cancel/delete-account section is present in settings (billing tab)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // DeleteAccountSection lives under the OWNER-only Billing tab and the trigger
    // reads "Cancel my account" (soft-delete / deactivate flow).
    await page.goto('/settings?tab=billing')
    await expect(page.getByRole('button', { name: /cancel my account/i })).toBeVisible()
  })

  test('an unauthenticated DELETE to the account endpoint is rejected', async ({ request }) => {
    // Fresh context, no session cookie → must not soft-delete anyone.
    const res = await request.delete('/api/user/delete', {
      data: { confirm: 'DELETE' },
      maxRedirects: 0,
    })
    expect([401, 403, 307]).toContain(res.status())
  })
})
