import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Client-facing booking wizard on /my-availability (the Calendly-style refresh):
// step 1 choose a session/class, step 2 pick a time, step 3 confirm.
//
// This drives the whole UI end-to-end against real seed data (a free, instant,
// self-bookable package + week-round 09:00–17:00 availability on Business A) up
// to — but not through — the final Confirm. We stop there on purpose: the suite
// runs fullyParallel against ONE shared DB, so completing the booking would
// create a live session that could race a concurrently-running spec. The POST
// itself (booking, tenant + availability guards) is covered by the unit tests
// self-book.test.ts and security/self-book-availability-route.test.ts.

async function loginAsClient(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.client.email)
  await page.getByLabel('Password').fill(SEED.client.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('my-availability booking wizard — client happy path', () => {
  test('choose a session, pick a time, reach confirm', async ({ page }) => {
    await loginAsClient(page)
    await page.goto('/my-availability')

    // Step 1 — the trainer header + the "choose" step, with our self-bookable
    // package listed under 1-on-1 sessions.
    // The name also sits in the client top bar, so scope to the page body.
    await expect(page.getByRole('main').getByText('E2E Dog School', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'What would you like to book?' })).toBeVisible()
    const sessionCard = page.getByRole('button', { name: /Self-Book Session/ })
    await expect(sessionCard).toBeVisible()
    await sessionCard.click()

    // Step 2 — the time picker. A day + a start time auto-select, so the
    // Continue button resolves to a concrete time.
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible()
    const continueBtn = page.getByRole('button', { name: /^Continue · / })
    await expect(continueBtn).toBeEnabled()
    await continueBtn.click()

    // Step 3 — confirmation summary. Free + instant → "Confirm booking".
    await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible()
    await expect(page.getByText('Self-Book Session').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeVisible()
  })
})
