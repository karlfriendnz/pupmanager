import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// /admin/trainers must list one row per COMPANY (account owners), not every
// individual trainer. Invited team members are TRAINER users with no profile of
// their own and must NOT appear as separate rows.

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.admin.email)
  await page.getByLabel('Password').fill(SEED.admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('admin /admin/trainers — companies, not individual trainers', () => {
  test('lists businesses and hides invited team members', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/trainers')

    await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()

    // Both companies appear (the owner's business + business B).
    await expect(page.getByText(SEED.owner.businessName).first()).toBeVisible()
    await expect(page.getByText(SEED.businessB.businessName).first()).toBeVisible()

    // Invited members (no company of their own) are NOT separate rows.
    await expect(page.getByText(SEED.manager.name)).toHaveCount(0)
    await expect(page.getByText(SEED.staff.name)).toHaveCount(0)
  })
})
