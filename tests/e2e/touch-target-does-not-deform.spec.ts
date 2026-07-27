import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

// globals.css forces `min-height: 44px; min-width: 44px` on every button, a and
// [role="button"] so nothing is too small to tap. min-* always beats
// height/width, so a small control written as `h-5 w-5` is silently inflated —
// the class list says 20px, the browser renders 44px, and nothing in TypeScript
// or a unit test can see the difference.
//
// It has bitten twice. Switches were squashed into 44×44 squares and rounded
// into circles. Then the to-do checkboxes: a 44px box around a 14px tick, three
// times the size of the text beside it, reported from a screenshot.
//
// The rule is: exempt the control from the minimum AND give it an invisible
// expanded hit area, so the ink stays small and the thumb still gets 44px.
// Only a real browser can check that, which is why this is an e2e test.

const MIN_TAP = 44

test.describe('small controls keep their size and their tap target', () => {
  test('a to-do checkbox is checkbox-sized, but still thumb-sized to hit', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/sessions/needs-notes?tab=todo')

    const title = `Checkbox size probe ${Date.now()}`
    await page.getByPlaceholder('Add a to-do…').fill(title)
    await page.getByPlaceholder('Add a to-do…').press('Enter')

    const box = page.getByRole('checkbox').first()
    await expect(box).toBeVisible()

    const ink = await box.boundingBox()
    expect(ink, 'the checkbox should render').not.toBeNull()

    // The ink: a checkbox, not a button. Comfortably under the 44px minimum —
    // that it CAN be is the whole point of the exemption.
    expect(Math.round(ink!.width), 'checkbox is inflated to the touch minimum').toBeLessThan(32)
    expect(Math.round(ink!.width)).toBe(Math.round(ink!.height))

    // The tap target: still at least 44px across, via the expanded hit area.
    // Measured by hit-testing outward from the centre, because the extra area
    // is a pseudo-element and has no box of its own to query.
    const reach = await box.evaluate((el, min) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const hits = (dx: number, dy: number) => {
        const at = document.elementFromPoint(cx + dx, cy + dy)
        return at === el || el.contains(at)
      }
      const half = min / 2
      return { x: hits(half - 1, 0) && hits(-(half - 1), 0), y: hits(0, half - 1) && hits(0, -(half - 1)) }
    }, MIN_TAP)

    expect(reach.x, `tap target narrower than ${MIN_TAP}px`).toBe(true)
    expect(reach.y, `tap target shorter than ${MIN_TAP}px`).toBe(true)

    // And it still does its job.
    await box.click()
    await expect(box).toHaveAttribute('aria-checked', 'true')
  })
})
