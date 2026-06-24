import { test } from '@playwright/test'
import { SEED } from './test-db'

const DIR = '/Users/karl/Desktop/Temp'

test('screenshot schedule submenu flyout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL('**/dashboard')

  await page.getByRole('link', { name: 'Schedule', exact: true }).hover()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/nav-flyout.png` })
})
