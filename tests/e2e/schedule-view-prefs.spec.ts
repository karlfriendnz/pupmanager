import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The schedule's layout choice follows the trainer, per device class: a phone
// remembers the day column, a desktop remembers the week, and neither
// overwrites the other. Stored on TrainerProfile (scheduleView /
// scheduleMobileView), same split as the visible-hours pair.

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** Opens the View panel, picks a layout, waits for the save, closes. */
async function chooseLayout(page: Page, label: 'Day' | '3 days' | 'Week') {
  await page.getByRole('button', { name: 'Schedule view options' }).click()
  const save = page.waitForResponse(r => r.url().includes('/api/trainer/profile') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: label, exact: true }).click()
  await save
  await page.getByRole('button', { name: 'Close' }).click()
}

/** Which layout the panel currently shows as chosen. */
async function currentLayout(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Schedule view options' }).click()
  // The layout rows are the only aria-pressed buttons in the panel carrying an
  // aria-label (the day toggles don't), and the label is exactly "Day" /
  // "3 days" / "Week". Reading the label rather than the row's text keeps this
  // working now each row also renders a hint line under its name.
  const active = page.locator('button[aria-pressed="true"][aria-label]')
  const label = (await active.first().getAttribute('aria-label')) ?? ''
  await page.getByRole('button', { name: 'Close' }).click()
  return label.trim()
}

test.describe('the schedule remembers its layout', () => {
  test('per trainer, and separately for phone and desktop', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Phone: choose Week, and it survives a reload.
    await page.setViewportSize(PHONE)
    await page.goto('/schedule')
    await chooseLayout(page, 'Week')
    await page.reload()
    expect(await currentLayout(page)).toBe('Week')

    // Desktop: still on its own default, and choosing Day doesn't disturb the
    // phone's choice — one saved value would fight whichever device came second.
    await page.setViewportSize(DESKTOP)
    await page.goto('/schedule')
    await chooseLayout(page, 'Day')
    await page.reload()
    expect(await currentLayout(page)).toBe('Day')

    await page.setViewportSize(PHONE)
    await page.goto('/schedule')
    expect(await currentLayout(page)).toBe('Week')
  })

  test('the View panel is reachable and closable on a phone', async ({ page }) => {
    // It once rendered inside the sticky header, so the app bar covered its
    // title and close button, and it had no scroll — you couldn't get out.
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.setViewportSize(PHONE)
    await page.goto('/schedule')

    await page.getByRole('button', { name: 'Schedule view options' }).click()
    const close = page.getByRole('button', { name: 'Close' })
    await expect(close).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

    // Standing rule: never two scrollbars — the page behind must be locked.
    const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
    expect(bodyOverflow).toBe('hidden')

    await close.click()
    await expect(close).toHaveCount(0)
    const afterClose = await page.evaluate(() => getComputedStyle(document.body).overflow)
    expect(afterClose).not.toBe('hidden')
  })
})
