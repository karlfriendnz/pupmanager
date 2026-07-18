import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// On mobile the schedule can be swiped left/right to move through days:
// - Day view (the mobile default) → next / previous day
// - 3-day view → next / previous set of 3 days
// This mirrors the existing Prev/Next controls, wired to touch.

void TEST_DATABASE_URL

// Phone-sized viewport so the schedule renders its mobile day view
// (isMobile = innerWidth < 640; the parent also defaults to the day view < 768).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

// Dispatch a horizontal swipe on a testid'd element (negative dx = left).
async function swipe(page: Page, testid: string, dx: number) {
  await page.evaluate(({ testid, deltaX }) => {
    const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null
    if (!el) throw new Error(`swipe target ${testid} not found`)
    const rect = el.getBoundingClientRect()
    const y = rect.top + Math.min(rect.height / 2, 200)
    const startX = rect.left + rect.width * 0.8
    const mk = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(startX)], bubbles: true, cancelable: true }))
    el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [mk(startX + deltaX)], bubbles: true, cancelable: true }))
  }, { testid, deltaX: dx })
}

test('swiping the mobile day view moves to the next / previous day', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/schedule')

  // The single-day view shows a full date header (e.g. "Sunday, 19 July 2026").
  const dateHeader = page.getByText(/\w+day, \d{1,2} \w+ \d{4}/).first()
  await expect(dateHeader).toBeVisible({ timeout: 20_000 })
  const day0 = (await dateHeader.textContent())?.trim()
  expect(day0).toBeTruthy()

  // Swipe left → next day.
  await swipe(page, 'day-swipe', -200)
  await expect.poll(async () => (await dateHeader.textContent())?.trim(), { timeout: 10_000 }).not.toBe(day0)

  // Swipe right → back to the original day.
  await swipe(page, 'day-swipe', 200)
  await expect.poll(async () => (await dateHeader.textContent())?.trim(), { timeout: 10_000 }).toBe(day0)
})

test('swiping the 3-day view moves to the next set of days', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/schedule')
  await page.getByRole('button', { name: '3-day view' }).click()

  const range = page.getByText(/\d{1,2} \w{3} – \d{1,2} \w{3}/).first()
  await expect(range).toBeVisible({ timeout: 20_000 })
  const before = (await range.textContent())?.trim()

  await swipe(page, 'schedule-scroll', -200)
  await expect.poll(async () => (await range.textContent())?.trim(), { timeout: 10_000 }).not.toBe(before)

  await swipe(page, 'schedule-scroll', 200)
  await expect.poll(async () => (await range.textContent())?.trim(), { timeout: 10_000 }).toBe(before)
})
