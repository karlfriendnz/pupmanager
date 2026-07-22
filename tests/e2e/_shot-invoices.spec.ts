import { test, type Page } from '@playwright/test'
import { SEED } from './test-db'

// TEMPORARY screenshot utility — deleted after visual verification.
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.client.email)
  await page.getByLabel('Password').fill(SEED.client.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/home', { timeout: 30_000 })
  const gate = page.getByRole('heading', { name: 'Before you get started' })
  if (await gate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const required = page.locator('input[placeholder="Required"]')
    for (let i = 0; i < await required.count(); i++) await required.nth(i).fill('E2E')
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await page.waitForTimeout(3000)
  }
  const maybeLater = page.getByRole('button', { name: 'Maybe later' })
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click()
}

test('shots', async ({ page }) => {
  await login(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/my-invoices')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/Users/karl/Desktop/Temp/my-invoices-desktop.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/Users/karl/Desktop/Temp/my-invoices-mobile.png' })
})
