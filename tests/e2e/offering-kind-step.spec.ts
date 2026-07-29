import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// "What are you setting up?" is only worth asking when the answer isn't already
// known. Tapping "New consult" on the Consults page has already answered it, so
// the wizard opens on the details; the generic "New offering" asks first, as a
// step of its own, and choosing moves straight on.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test('the generic New offering asks what it is first, then moves on to the details', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/offerings/new')

  // Step one is the question, and nothing else — the name field comes after.
  await expect(page.getByText('What are you setting up?')).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveCount(0)

  // Choosing IS the step: one tap lands on the details.
  await page.getByRole('button', { name: /Group class/ }).click()
  await expect(page.getByLabel('Name')).toBeVisible()
  await expect(page.getByText('What are you setting up?')).toHaveCount(0)

  // Back returns to the question with the choice still made, so a mis-tap is
  // one tap to undo.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('button', { name: /Group class/ })).toHaveAttribute('aria-pressed', 'true')
})

test('New consult goes straight to the details and says so', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/packages')

  await page.getByRole('link', { name: 'New consult' }).first().click()
  await page.waitForURL('**/offerings/new**')

  // The kind came with the link, so it is never asked — and the page calls
  // itself what they tapped, not "New offering".
  await expect(page.getByText('What are you setting up?')).toHaveCount(0)
  await expect(page.getByLabel('Name')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New consult' })).toBeVisible()
})
