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
    // Email templates moved BACK into Settings (2026-07-30) — /email-templates
    // is a redirect now, kept because the old url is in bookmarks, so arriving
    // through it is part of the feature.
    await page.goto('/email-templates')
    await expect(page, 'the old email-templates url no longer lands on the panel')
      .toHaveURL(/\/settings\?tab=emails/, { timeout: 20_000 })
    // Templates are chosen from one dropdown now; creating is its last option.
    const picker = page.getByLabel('Choose an email template')
    await expect(picker).toBeEnabled({ timeout: 20_000 })
    await picker.selectOption('__new')

    const name = `Welcome ${Date.now()}`
    // exact: getByPlaceholder matches case-insensitive SUBSTRINGS, and the
    // subject placeholder is now "A warm welcome to the pack" — which contains
    // the name field's placeholder, so a loose match hits both inputs.
    await page.getByPlaceholder('Welcome to the pack', { exact: true }).fill(name)
    await page.getByPlaceholder('A warm welcome to the pack').fill('Hello {{clientName}}')
    // Body is a rich-text (contenteditable) editor — type into it directly.
    // `:visible` matters now the panel lives in Settings: every tab's content is
    // in the DOM at once (the one you aren't on is `hidden`), so an unfiltered
    // .first() picks up a contenteditable on some other tab and the click times
    // out on an element that is display:none.
    const editor = page.locator('[contenteditable="true"]:visible').first()
    await editor.click()
    await editor.pressSequentially('Welcome to the pack — great to have you!')

    await page.getByRole('button', { name: 'Create template' }).click()
    // The new template joins the picker. Its <option> counts as hidden to
    // Playwright, so assert the select's contents rather than visibility.
    await expect(picker).toContainText(name, { timeout: 10_000 })
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

test.describe('add-ons — the main nav reflects a toggled add-on', () => {
  test('turning Group classes off hides the Classes nav item', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // Group classes is free + default-on, so the sidebar link starts visible on
    // the dashboard (a main-nav page). Label must track app-shell.tsx's nav —
    // it was renamed "Classes" → "Group Classes" and this exact-match selector
    // wasn't updated with it, which quietly reddened the suite.
    const classesNav = page.getByRole('link', { name: 'Group Classes', exact: true })
    await expect(classesNav).toBeVisible()

    // Settings split in two: Add-ons keeps the PAID extras, and everything
    // included with the plan moved to Configure — which is where Group classes
    // lives, because it is free and on by default. Configure toggles in place
    // with a switch rather than opening a "learn more" panel first.
    async function toggleClasses(off: boolean) {
      await page.goto('/settings?tab=configure')
      const toggle = page
        .getByRole('switch', { name: /Group classes/ })
        .or(page.getByLabel(/Group classes —/))
        .first()
      await expect(toggle).toBeVisible({ timeout: 15_000 })
      await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/addons') && r.request().method() === 'POST'),
        toggle.click(),
      ])
      void off
      await page.goto('/dashboard')
    }

    await toggleClasses(true)
    await expect(classesNav).toBeHidden({ timeout: 10_000 })

    // Turn it back on so the nav state doesn't leak into other specs.
    await toggleClasses(false)
    await expect(classesNav).toBeVisible({ timeout: 10_000 })
  })
})

// REMOVED: 'starter field packs' and 'fields & forms'.
//
// Both drove the Fields tab, which was deleted on 2026-07-30 (59a7104,
// "the Fields tab is gone — a field belongs to the form that asks it") along
// with the per-company field config behind it — about 1,600 lines. A field is
// created on the form that asks it now, and requiredness belongs to that
// form's questions rather than to a global setting. There is no screen left
// for these to test, so they are gone rather than rewritten.
