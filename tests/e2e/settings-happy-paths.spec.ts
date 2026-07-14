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
    // Email templates moved out of Settings to their own page under Communication.
    await page.goto('/email-templates')
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

test.describe('add-ons — nav reacts without a reload', () => {
  test('turning Group classes off hides the Classes nav item immediately', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings?tab=addons')

    // Group classes is free + default-on, so the nav link starts visible.
    const classesNav = page.getByRole('link', { name: 'Classes', exact: true })
    await expect(classesNav).toBeVisible()

    await page.getByRole('button', { name: /Group classes/ }).first().click()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/addons') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Turn off Group classes' }).click(),
    ])

    // No page.reload() here — that's the regression this guards.
    await expect(classesNav).toBeHidden({ timeout: 10_000 })

    // Turn it back on so the nav state doesn't leak into other specs.
    await page.getByRole('button', { name: /Group classes/ }).first().click()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/addons') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Turn on Group classes' }).click(),
    ])
    await expect(classesNav).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('custom fields — owner happy path', () => {
  test('owner creates a custom field without picking a section first', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings?tab=customfields')

    // The toolbar "Add field" opens the editor in the no-section bucket — no
    // section needs to exist for this to work.
    await page.getByRole('button', { name: 'Add field', exact: true }).first().click()

    const label = `Microchip ${Date.now()}`
    await page.getByPlaceholder("e.g. Dog's breed").fill(label)
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/custom-fields') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add field', exact: true }).last().click(),
    ])
    expect(resp.ok()).toBeTruthy()

    // It lands in the "Fields without a section" bucket and survives a reload.
    await page.reload()
    await expect(page.getByText('Fields without a section')).toBeVisible({ timeout: 10_000 })
    // Innermost div holding both the label and its pencil = the field row.
    const row = page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Edit field' }) })
      .last()
    await expect(row).toBeVisible()

    // Clean up so the field count doesn't leak into other specs.
    await row.getByRole('button', { name: 'Edit field' }).click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/custom-fields/') && r.request().method() === 'DELETE'),
      page.getByRole('button', { name: 'Confirm' }).click(),
    ])
  })
})
