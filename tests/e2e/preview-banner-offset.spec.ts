import { test, expect, type Page } from '@playwright/test'

// The amber "Previewing as …" bar a trainer sees while walking the client app.
//
// It used to be `sticky top-0 z-50`, which looked fine at rest and covered
// things the moment anything moved:
//   * the shell's phone brand bar is ALSO sticky top-0 (z-30), so on scroll
//     both parked at y=0 and the banner hid it — logo and account button gone;
//   * the desktop sidebar is `fixed inset-y-0`, so its logo sat under the
//     banner even at scroll 0.
// The layout "compensated" by adding 2.75rem to --app-safe-top, a variable the
// CLIENT shell never reads, for a bar that actually measured 61px.
//
// The bar is now genuinely fixed and everything the shell pins to the top of
// the viewport is pushed down by exactly its height. This spec measures that
// rather than trusting the CSS.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

type Box = { top: number; bottom: number; height: number; position: string } | null

async function geometry(page: Page) {
  return await page.evaluate(() => {
    const box = (el: Element | null): Box => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: r.height, position: getComputedStyle(el).position }
    }
    return {
      banner: box(document.querySelector('.pm-preview-banner')),
      header: box(document.querySelector('.pm-preview-shell header')),
      aside: box(document.querySelector('.pm-preview-shell aside')),
      main: box(document.querySelector('.pm-preview-shell main')),
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    }
  })
}

test.describe('trainer preview banner never covers the app', () => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    test(`${label}: the shell starts below the bar, at rest and scrolled`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      const { SEED } = await import('./test-db')
      await login(page, SEED.owner.email, SEED.owner.password)

      // Enter the client app as the seeded dog owner.
      await page.goto(`/preview-as/${SEED.assignedClientId}`)
      await page.goto('/my-availability')
      await expect(page.getByText(/Previewing as/)).toBeVisible({ timeout: 20_000 })

      const atrest = await geometry(page)
      expect(atrest.banner, 'the banner renders').not.toBeNull()
      expect(atrest.banner!.position).toBe('fixed')
      expect(atrest.banner!.top).toBe(0)

      // Nothing the shell pins to the top starts above the bar's bottom edge.
      const floor = atrest.banner!.height
      if (atrest.header && atrest.header.height > 0) {
        expect(atrest.header.top).toBeGreaterThanOrEqual(floor - 1)
      }
      if (atrest.aside && atrest.aside.height > 0) {
        expect(atrest.aside.top).toBeGreaterThanOrEqual(floor - 1)
      }
      expect(atrest.main!.top).toBeGreaterThanOrEqual(floor - 1)

      // …and still not after a scroll, which is where the sticky bar collided
      // with the sticky header.
      await page.evaluate(() => window.scrollTo(0, 400))
      await page.waitForTimeout(300)
      const scrolled = await geometry(page)
      expect(scrolled.banner!.top).toBe(0)
      if (scrolled.header && scrolled.header.height > 0) {
        expect(scrolled.header.top).toBeGreaterThanOrEqual(scrolled.banner!.height - 1)
      }
      if (scrolled.aside && scrolled.aside.height > 0) {
        expect(scrolled.aside.top).toBeGreaterThanOrEqual(scrolled.banner!.height - 1)
      }
    })
  }

  test('a real client sees no banner and no offset', async ({ page }) => {
    const { SEED } = await import('./test-db')
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page, SEED.client.email, SEED.client.password)
    await page.goto('/my-availability')
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 })

    await expect(page.locator('.pm-preview-banner')).toHaveCount(0)
    await expect(page.locator('.pm-preview-shell')).toHaveCount(0)
    // The shell's own header still starts flush at the top of the viewport.
    const header = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().top ?? null)
    expect(header).toBeLessThanOrEqual(1)
  })
})
