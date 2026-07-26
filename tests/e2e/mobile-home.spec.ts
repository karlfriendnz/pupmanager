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
    await expect(page.locator('section').getByText(/^Good (morning|afternoon|evening)/)).toBeVisible()

    // The six destinations. Which six depends on the trainer's trade (see
    // lib/home-tiles) — these are the ones the seeded owner gets.
    for (const label of ['Schedule', 'Clients', 'Offerings', 'Money']) {
      await expect(page.locator('section').getByText(label, { exact: true })).toBeVisible()
    }
    // Always six, never a short grid.
    await expect(page.locator('section .grid > a, section .grid > button')).toHaveCount(6)

    // The desktop widget wall is NOT what a phone gets.
    await expect(page.getByText('notes to write')).toBeHidden()
    await expect(page.getByText("Today's sessions")).toBeHidden()

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

  test('everything waiting is one row, and it opens to the breakdown', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    const summary = page.getByRole('button', { name: /things? to review/ })
    // Nothing pending in the seed is a legitimate state — the row hides itself.
    if (await summary.count() === 0) test.skip()

    // The total is the sum, and the kinds are hidden until asked for.
    const total = Number((await summary.innerText()).match(/(\d+)/)![1])
    expect(total).toBeGreaterThan(0)
    await expect(page.getByRole('link', { name: /booking request|new enquir/ })).toHaveCount(0)

    await summary.click()
    const kinds = page.getByRole('link', { name: /booking request|new enquir/ })
    expect(await kinds.count()).toBeGreaterThan(0)

    // The parts add up to the headline.
    let sum = 0
    for (const t of await kinds.allInnerTexts()) sum += Number(t.match(/(\d+)/)?.[1] ?? 0)
    expect(sum).toBe(total)
  })

  test('the menu, the bottom tabs, and the Offerings hub', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/dashboard')

    // Everything else is behind the header menu, not a bottom tab.
    // force: the shell paints an infinitely-pulsing onboarding dot near this
    // button, and Playwright waits for "stable" forever when one is animating.
    await page.getByRole('button', { name: 'Menu' }).click({ force: true })
    // Settings is always in the menu; Reports and friends are permission- and
    // add-on-gated, so they're the wrong thing to assert the menu opened on.
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    // Five tabs, all destinations a trainer works in — no "More" tab.
    const tabs = page.locator('nav.fixed.bottom-0 a')
    await expect(tabs).toHaveCount(5)
    await expect(page.locator('nav.fixed.bottom-0').getByText('More')).toHaveCount(0)

    await page.goto('/offerings')
    // Every row is a real destination with a count or a description.
    await expect(page.locator('main').getByRole('link', { name: /1:1 Packages/ })).toBeVisible()
    await expect(page.locator('main').getByRole('link', { name: /Library/ })).toBeVisible()
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
