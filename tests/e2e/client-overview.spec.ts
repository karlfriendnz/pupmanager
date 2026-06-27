import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Owner happy path for the redesigned client-profile Overview tab. The tab
// leads with the things a trainer scans a client for — upcoming sessions,
// unpaid invoices, the latest session, recent communication — instead of the
// old tasks/compliance stat cards. The seeded "Sarah Client" has none of that
// data yet, so this asserts the four panels render (with their empty states),
// which is the regression that matters: the tab loads and is laid out right.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('client overview — owner happy path', () => {
  test('Overview tab shows the priority panels', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients')
    await page.getByRole('link', { name: /Sarah Client/ }).first().click()
    await page.waitForURL('**/clients/**')

    // Overview is the default tab — its four section headings always render.
    await expect(page.getByRole('heading', { name: 'Upcoming sessions' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Unpaid invoices' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Latest session' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent communication' })).toBeVisible()

    // The old tasks-centric content is gone.
    await expect(page.getByText('Recent tasks')).toHaveCount(0)
    await expect(page.getByText('14-day compliance')).toHaveCount(0)
  })
})
