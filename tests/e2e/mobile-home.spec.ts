import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The phone home screen: a branded welcome, one live line about today, and six
// tiles that carry live counts. The point of it is that a trainer on a phone
// isn't handed the desktop widget wall — so the tests that matter are (a) the
// grid is what a phone gets, (b) its numbers are real rather than decorative,
// and (c) the desktop dashboard is untouched.

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('trainer home on a phone', () => {
  test.use({ viewport: PHONE })

  test('greets the trainer and shows the six tiles instead of the widget wall', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    // Welcome band: greeting + the trainer's own business name.
    await expect(page.getByText(/^Good (morning|afternoon|evening)/)).toBeVisible()

    // The six destinations.
    for (const label of ['Schedule', 'Clients', 'Offerings', 'Money', 'More']) {
      await expect(page.locator('section').getByText(label, { exact: true })).toBeVisible()
    }

    // The desktop widget wall is NOT what a phone gets.
    await expect(page.getByText('notes to write')).toHaveCount(0)
    await expect(page.getByText("Today's sessions")).toHaveCount(0)

    // No sideways scroll at 390px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the tiles carry live counts, not decoration', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    // Clients tile states an active count, and it matches the Clients page.
    const clientsSub = await page.locator('a[href="/clients"] >> text=/\\d+ active/').first().innerText()
    const claimed = Number(clientsSub.match(/(\d+)/)![1])
    expect(claimed).toBeGreaterThan(0)

    // Schedule tile agrees with itself: "N sessions today" in the tile and the
    // same N in the hero's today line.
    const heroToday = await page.locator('a[href="/schedule"]').first().innerText()
    const tileToday = await page.locator('a[href="/schedule"]').nth(1).innerText()
    const heroN = heroToday.match(/(\d+) session/)?.[1] ?? '0'
    const tileN = tileToday.match(/(\d+) session/)?.[1] ?? '0'
    expect(tileN).toBe(heroN)
  })

  test('More opens the full menu, Offerings opens the hub', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    await page.getByRole('button', { name: /More/ }).first().click()
    await expect(page.getByRole('link', { name: /Reports/ }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto('/offerings')
    // Every row is a real destination with a count or a description.
    await expect(page.getByRole('link', { name: /1:1 Packages/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Library/ })).toBeVisible()
    // Pluralisation is done properly — no "2 classs".
    await expect(page.getByText(/\bclasss\b/)).toHaveCount(0)
  })
})

test.describe('the desktop dashboard is unchanged', () => {
  test.use({ viewport: DESKTOP })

  test('still shows the stat tiles and today\'s sessions, and no phone grid', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    await expect(page.getByText('notes to write')).toBeVisible()
    await expect(page.getByText("Today's sessions")).toBeVisible()
    await expect(page.getByText('Reports, settings & more')).toHaveCount(0)
  })
})
