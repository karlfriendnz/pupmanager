import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Settings → Design used to render the client-app preview BELOW the controls
// card, leaving the card's right-hand column empty. It now sits inside the
// card, beside the controls on desktop and under them on a phone — and it
// still repaints live as the brand colour changes.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function openDesignTab(page: Page) {
  await page.goto('/settings?tab=design')
  await expect(page.getByRole('button', { name: 'Save design' })).toBeVisible({ timeout: 20_000 })
}

test.describe('Settings → Design', () => {
  test('the preview sits beside the controls on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await openDesignTab(page)

    const preview = page.getByTestId('brand-preview-column')
    await expect(preview).toBeVisible()

    // Two columns: the preview starts to the RIGHT of the Save button, and
    // shares its vertical band rather than sitting under it.
    const save = page.getByRole('button', { name: 'Save design' })
    const previewBox = await preview.boundingBox()
    const saveBox = await save.boundingBox()
    expect(previewBox).not.toBeNull()
    expect(saveBox).not.toBeNull()
    expect(previewBox!.x).toBeGreaterThan(saveBox!.x + saveBox!.width)
    expect(previewBox!.y).toBeLessThan(saveBox!.y)
  })

  test('the preview stacks under the controls on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await openDesignTab(page)

    const preview = page.getByTestId('brand-preview-column')
    await expect(preview).toBeVisible()

    const save = page.getByRole('button', { name: 'Save design' })
    const previewBox = await preview.boundingBox()
    const saveBox = await save.boundingBox()
    expect(previewBox!.y).toBeGreaterThan(saveBox!.y)
    // And it stays inside the viewport — no sideways scroll.
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(390)
  })

  test('the preview repaints as the brand colour changes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await openDesignTab(page)

    const preview = page.getByTestId('brand-preview-column')
    const hex = page.locator('input[type="text"][placeholder^="#"]').first()
    await hex.fill('#123456')

    // Something inside the preview picks the colour up — no save required.
    await expect
      .poll(async () => preview.locator('[style*="rgb(18, 52, 86)"], [style*="#123456"]').count())
      .toBeGreaterThan(0)
  })
})
