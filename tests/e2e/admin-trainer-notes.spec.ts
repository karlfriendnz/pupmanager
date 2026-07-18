import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Super-admin can keep an internal progress diary + to-dos per trainer business
// on the trainer detail page.

void TEST_DATABASE_URL

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.admin.email)
  await page.getByLabel('Password').fill(SEED.admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('admin can add an internal note and a to-do to a trainer', async ({ page }) => {
  await loginAdmin(page)
  await page.goto('/admin/trainers')

  await page
    .locator('table a[href^="/admin/trainers/"]')
    .filter({ hasText: SEED.owner.name })
    .first()
    .click()
  await page.waitForURL(/\/admin\/trainers\/.+/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: SEED.owner.businessName })).toBeVisible()

  const todo = `Follow up on billing ${Date.now()}`
  await page.getByPlaceholder('Add a to-do…').fill(todo)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText(todo)).toBeVisible({ timeout: 15_000 })

  const note = `Trial going really well ${Date.now()}`
  await page.getByPlaceholder(/Record a note about this trainer/).fill(note)
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText(note)).toBeVisible({ timeout: 15_000 })

  // Persists across a reload.
  await page.reload()
  await expect(page.getByText(todo)).toBeVisible()
  await expect(page.getByText(note)).toBeVisible()
})
