import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Owner happy-path UI flows for two settings features that previously had only
// API/cross-tenant coverage: creating an email template, and the
// show-phone-to-clients toggle. Runs against the isolated embedded Postgres
// (see global-setup.ts).

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('email templates — owner happy path', () => {
  test('owner creates a reusable template and it appears in the list', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Email templates' }).click()
    await page.getByRole('button', { name: 'New template' }).click()

    const name = `Welcome ${Date.now()}`
    await page.getByPlaceholder('Welcome to the pack').fill(name)
    await page.getByPlaceholder('A warm welcome from {{businessName}}').fill('Hello {{clientName}}')
    // Body is a rich-text (contenteditable) editor — type into it directly.
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.click()
    await editor.pressSequentially('Welcome to the pack — great to have you!')

    await page.getByRole('button', { name: 'Create template' }).click()
    // The new template shows as a chip in the list.
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('phone visibility — owner happy path', () => {
  test('owner can toggle "show phone to clients" and it persists', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings') // Profile tab; "Business details" accordion is open by default

    const checkbox = page.getByRole('checkbox', { name: /Show my phone number/i })
    const before = await checkbox.isChecked()

    await checkbox.click()
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/trainer/profile') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save business details' }).click(),
    ])
    expect(resp.ok()).toBeTruthy()

    await page.reload()
    await expect(page.getByRole('checkbox', { name: /Show my phone number/i })).toBeChecked({ checked: !before })

    // Restore the seeded default so the toggle state doesn't leak to other specs.
    await page.getByRole('checkbox', { name: /Show my phone number/i }).click()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/trainer/profile') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save business details' }).click(),
    ])
  })
})
