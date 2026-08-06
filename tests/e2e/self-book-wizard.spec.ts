import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '../../src/lib/feature-flags'

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

    // Step 1 — the "choose" step, a menu of offering TYPES; drill into 1-on-1
    // sessions to reach our package. The trainer's name is in the intro copy
    // ("…from E2E Dog School.") and also in the client top bar, so match loosely
    // and scope to the page body.
    await expect(page.getByRole('heading', { name: 'What would you like to book?' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('main').getByText(/E2E Dog School/).first()).toBeVisible()
    await page.getByRole('button', { name: /1-on-1 sessions/ }).click()
    const sessionCard = page.getByRole('button', { name: /Self-Book Session/ })
    await expect(sessionCard).toBeVisible()
    await sessionCard.click()

    // Step 2 — the time picker. Picking the time IS the decision now: the
    // separate "Continue · <time>" button is gone, and tapping a start time
    // moves the wizard on by itself.
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible()
    const startTime = page.getByRole('button', { name: /^\d{1,2}(:\d{2})? [AP]M$/ }).first()
    await expect(startTime).toBeEnabled({ timeout: 15_000 })
    await startTime.click()

    // Step 3 — confirmation summary. Free + instant → "Confirm booking".
    await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible()
    await expect(page.getByText('Self-Book Session').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeVisible()
  })

  // Memberships are a type INSIDE this flow rather than their own nav entry.
  test('memberships are an offering type, not a nav entry', async ({ page }) => {
    // Packages are hidden from clients right now (see feature-flags.ts).
    // This spec covers the client-facing package journey, which therefore
    // does not exist. It un-skips itself the moment the flag flips back.
    test.skip(PACKAGES_HIDDEN_FROM_CLIENTS, 'Packages hidden from clients')
    await loginAsClient(page)
    await page.goto('/my-availability')

    await expect(page.getByRole('heading', { name: 'What would you like to book?' })).toBeVisible({ timeout: 15_000 })
    // No Memberships link in the client nav any more — it lives here now.
    await expect(page.getByRole('link', { name: 'Packages' })).toHaveCount(0)

    await page.getByRole('button', { name: /Packages/ }).click()
    // The card renders the trainer's styling, price and included items; buying
    // hands off to Stripe, so we stop at the button.
    await expect(page.getByRole('heading', { name: SEED.membershipName })).toBeVisible()
    await expect(page.getByText('$120')).toBeVisible()
    await expect(page.getByText('2× Self-Book Session')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get this package' })).toBeVisible()

    // Back out to the type menu.
    await page.getByRole('button', { name: 'All offerings' }).click()
    await expect(page.getByRole('button', { name: /1-on-1 sessions/ })).toBeVisible()
  })
})
