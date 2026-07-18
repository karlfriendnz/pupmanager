import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// A trainer can choose whether opening the app lands them on the Dashboard
// (default) or the Schedule. The preference is honoured by the root ("/")
// redirect in app/page.tsx.

void TEST_DATABASE_URL

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('opening the app honours the trainer landing-page preference', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  try {
    // Choose Schedule as the landing page (the settings form saves this field).
    const set = await page.request.patch('/api/user', { data: { landingPage: 'schedule' } })
    expect(set.ok()).toBe(true)

    // Opening the app (root) now lands on the Schedule.
    await page.goto('/')
    await page.waitForURL('**/schedule', { timeout: 15_000 })
  } finally {
    // Restore the default so other specs (which expect owner → dashboard) are
    // unaffected in this shared, sequential DB.
    await page.request.patch('/api/user', { data: { landingPage: 'dashboard' } })
  }

  // Back on the default → root lands on the Dashboard.
  await page.goto('/')
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
})
