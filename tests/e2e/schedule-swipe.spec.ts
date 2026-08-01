import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// On mobile the schedule can be swiped left/right to move through days:
// - Day view (the mobile default) → next / previous day
// - 3-day view → next / previous set of 3 days
// This mirrors the existing Prev/Next controls, wired to touch.

// Picking "3 days" below is a real trainer action, so it PERSISTS on the shared
// seeded trainer (TrainerProfile.scheduleMobileView). Put the seeded default
// back or every later phone-sized spec opens the 3-day grid instead of the day
// list it expects.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })

test.afterAll(async () => {
  await prisma.trainerProfile.updateMany({
    where: { businessName: SEED.owner.businessName },
    data: { scheduleView: null, scheduleMobileView: null },
  })
  await prisma.$disconnect()
})

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

  // Pick Agenda explicitly. The layout is saved on the trainer's PROFILE
  // (scheduleView / scheduleMobileView), so it is not per-test state: any spec
  // that chose another view leaves this one looking at a grid with no
  // day-swipe and no date header. "Agenda" is the one-day list this covers.
  await page.getByRole('button', { name: 'Schedule view options' }).click()
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  // The single-day view shows a full date header (e.g. "Sunday, 19 July 2026").
  // Phones show the short form ("Mon, 27 Jul"); desktop keeps the long one.
  const dateHeader = page.getByText(/\w{3,},? \d{1,2} \w{3}/).first()
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

// The 3-day window's date row is `hidden sm:flex` — deliberately dropped below
// 640px, where there is no room for it beside the Prev/Next controls (Karl,
// 2026-07-27). The window itself is no longer mobile-only, so this runs just
// wide enough for the label to exist while still driving it by touch.
test.describe('the 3-day window, wide enough to show its date row', () => {
  test.use({ viewport: { width: 700, height: 844 }, hasTouch: true })

  test('swiping the 3-day view moves to the next set of days', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/schedule')
  // Layout lives in the View panel now, as words rather than icons.
  await page.getByRole('button', { name: 'Schedule view options' }).click()
  await page.getByRole('button', { name: '3 days', exact: true }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  // The 3-day window's own label, not `.first()` match of the date regex — that
  // was the WEEK range in the page header, which only changes when a swipe
  // spills into the next week. Whether it did depended on which weekday "today"
  // happened to be, so this passed on a Sunday and failed on a Monday.
  const range = page.getByTestId('three-day-range')
  await expect(range).toBeVisible({ timeout: 20_000 })
  const before = (await range.textContent())?.trim()

  await swipe(page, 'schedule-scroll', -200)
  await expect.poll(async () => (await range.textContent())?.trim(), { timeout: 10_000 }).not.toBe(before)

  await swipe(page, 'schedule-scroll', 200)
  await expect.poll(async () => (await range.textContent())?.trim(), { timeout: 10_000 }).toBe(before)
  })
})
