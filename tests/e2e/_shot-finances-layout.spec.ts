import { test, type Page } from '@playwright/test'
import { SEED } from './test-db'

// TEMPORARY screenshot utility for the Finances layout fixes — delete after
// visual verification. Underscore-prefixed, so it is excluded from the suite.
const DIR = '/Users/karl/Desktop/Temp'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test('finances shots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  await page.goto('/finances')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${DIR}/fin-invoices-390.png` })

  await page.getByRole('button', { name: 'Transactions' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${DIR}/fin-transactions-390.png` })

  await page.goto('/finances')
  await page.waitForTimeout(1500)
  await page.getByTestId('rcv-row').filter({ hasText: 'Editable Invoice' }).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${DIR}/fin-doc-bar-390.png` })

  await page.getByRole('button', { name: 'More' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/fin-doc-sheet-390.png` })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/finances')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${DIR}/fin-invoices-1440.png` })

  await page.getByTestId('rcv-row-desktop').filter({ hasText: 'Editable Invoice' }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'More' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/fin-doc-sheet-1440.png` })
})
