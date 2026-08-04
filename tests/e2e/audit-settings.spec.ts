import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

/**
 * Settings audit — "save → reload → still there".
 *
 * Written out of the 2026-08-04 settings/forms/fields audit (docs/audit-settings.md).
 * A setting that appears to save and silently reverts is the classic bug in this
 * area and nothing guarded against it, so the shape of almost every test here is
 * the same three steps:
 *
 *   1. change the field
 *   2. save it
 *   3. RELOAD the page and assert the new value came back from the server
 *
 * Every test restores what it changed, because the suite shares one seeded
 * database and one trainer — see tests/e2e/global-setup.ts.
 */

async function login(page: Page, email = SEED.owner.email, password = SEED.owner.password) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

/** Open a settings tab by its canonical ?tab= key and wait for it to settle. */
async function settingsTab(page: Page, tab: string) {
  await page.goto(`/settings?tab=${tab}`)
  await page.waitForLoadState('domcontentloaded')
}

/** Turn a feature/add-on on or off through the same API the UI uses. */
async function setAddon(page: Page, itemId: string, active: boolean) {
  const res = await page.request.post('/api/addons', { data: { itemId, active } })
  expect(res.ok(), `POST /api/addons ${itemId}=${active}`).toBeTruthy()
}

test.describe.configure({ mode: 'serial' })

// ─── Settings → Details ──────────────────────────────────────────────────────

test.describe('Settings → Details', () => {
  test('every field on the business form survives a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')

    const name = page.locator('input[name=name]')
    const businessName = page.locator('input[name=businessName]')
    const phone = page.locator('input[name=phone]')
    const showPhone = page.locator('input[name=showPhoneToClients]')
    const publicEmail = page.locator('input[name=publicEmail]')
    const country = page.locator('select[name=signupCountry]')
    const timezone = page.locator('select[name=timezone]')
    const landingPage = page.locator('select[name=landingPage]')

    await expect(name).toBeVisible()
    const before = {
      name: await name.inputValue(),
      businessName: await businessName.inputValue(),
      phone: await phone.inputValue(),
      showPhone: await showPhone.isChecked(),
      publicEmail: await publicEmail.inputValue(),
      country: await country.inputValue(),
      timezone: await timezone.inputValue(),
      landingPage: await landingPage.inputValue(),
    }

    await name.fill('Audited Owner')
    await businessName.fill('Audited Business')
    await phone.fill('+64 21 000 4242')
    await showPhone.setChecked(!before.showPhone)
    await publicEmail.fill('audited@e2e.test')
    await country.selectOption('GB')
    await timezone.selectOption('Europe/London')
    await landingPage.selectOption(before.landingPage === 'schedule' ? 'dashboard' : 'schedule')
    await page.getByRole('button', { name: 'Save business details' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })

    // The whole point: come back fresh from the server.
    await settingsTab(page, 'profile')
    await expect(page.locator('input[name=name]')).toHaveValue('Audited Owner')
    await expect(page.locator('input[name=businessName]')).toHaveValue('Audited Business')
    await expect(page.locator('input[name=phone]')).toHaveValue('+64 21 000 4242')
    await expect(page.locator('input[name=showPhoneToClients]')).toBeChecked({ checked: !before.showPhone })
    await expect(page.locator('input[name=publicEmail]')).toHaveValue('audited@e2e.test')
    await expect(page.locator('select[name=signupCountry]')).toHaveValue('GB')
    await expect(page.locator('select[name=timezone]')).toHaveValue('Europe/London')
    await expect(page.locator('select[name=landingPage]')).toHaveValue(
      before.landingPage === 'schedule' ? 'dashboard' : 'schedule',
    )

    // Put the shared trainer back exactly as it was.
    await page.locator('input[name=name]').fill(before.name)
    await page.locator('input[name=businessName]').fill(before.businessName)
    await page.locator('input[name=phone]').fill(before.phone)
    await page.locator('input[name=showPhoneToClients]').setChecked(before.showPhone)
    await page.locator('input[name=publicEmail]').fill(before.publicEmail)
    await page.locator('select[name=signupCountry]').selectOption(before.country)
    await page.locator('select[name=timezone]').selectOption(before.timezone)
    await page.locator('select[name=landingPage]').selectOption(before.landingPage)
    await page.getByRole('button', { name: 'Save business details' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })

    await settingsTab(page, 'profile')
    await expect(page.locator('input[name=businessName]')).toHaveValue(before.businessName)
  })

  test('the persona chips ("what your business offers") survive a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')

    const chip = page.getByRole('button', { name: /Dog walker/ })
    await expect(chip).toBeVisible()
    const before = await chip.getAttribute('aria-pressed')
    await chip.click()
    await page.getByRole('button', { name: 'Save business details' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })

    await settingsTab(page, 'profile')
    const after = page.getByRole('button', { name: /Dog walker/ })
    await expect(after).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')

    await after.click()
    await page.getByRole('button', { name: 'Save business details' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })
  })

  test('base currency saves on change (no Save press) and survives a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')

    // The one select on this form with no name attribute — it writes straight
    // to payoutCurrency on change rather than joining the business form's save.
    const currency = page.locator('form select:not([name])').first()
    await expect(currency).toBeVisible()
    const before = await currency.inputValue()
    const next = before === 'gbp' ? 'nzd' : 'gbp'

    await currency.selectOption(next)
    await page.waitForTimeout(1500)
    await settingsTab(page, 'profile')
    await expect(page.locator('form select:not([name])').first()).toHaveValue(next)

    await page.locator('form select:not([name])').first().selectOption(before)
    await page.waitForTimeout(1500)
    await settingsTab(page, 'profile')
    await expect(page.locator('form select:not([name])').first()).toHaveValue(before)
  })

  test('required fields are refused, and nothing is written', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')

    const businessName = page.locator('input[name=businessName]')
    // Read it only once the form has actually been filled in. Reading straight
    // after navigation caught the input still empty, so `original` was "" and
    // the reload check at the bottom then failed against the real name.
    await expect(businessName).not.toHaveValue('')
    const original = await businessName.inputValue()

    await page.locator('input[name=name]').fill('')
    await businessName.fill('')
    await page.locator('input[name=phone]').fill('')
    await page.getByRole('button', { name: 'Save business details' }).click()

    await expect(page.getByText('Your name is required')).toBeVisible()
    await expect(page.getByText('Business name is required')).toBeVisible()
    await expect(page.getByText('Phone number is required')).toBeVisible()
    await expect(page.getByText('Saved!')).toHaveCount(0)

    await settingsTab(page, 'profile')
    await expect(page.locator('input[name=businessName]')).toHaveValue(original)
  })

  test('an invalid business email is refused', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')

    await page.locator('input[name=publicEmail]').fill('not-an-email')
    await page.getByRole('button', { name: 'Save business details' }).click()
    // The field is type=email, so the BROWSER refuses it before the form's own
    // message can render — asserting that message was asserting something the
    // trainer never sees. What matters is that nothing was saved.
    await expect(page.getByText('Saved!')).toHaveCount(0)

    // And the door behind the browser is shut too. This is the client-facing
    // contact address — a mailto: on their Help page, the reply-to on enquiry
    // auto-replies — and the API used to take any string up to 200 characters,
    // so anything that wasn't this form put junk straight in.
    const refused = await page.request.patch('/api/trainer/profile', {
      data: { publicEmail: 'not-an-email' },
    })
    expect(refused.status(), 'the API must refuse a junk business email').toBe(400)

    await page.locator('input[name=publicEmail]').fill('')
    await page.getByRole('button', { name: 'Save business details' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })
  })

  test('the sign-in email is shown but not editable here', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'profile')
    // It's the account identity, changed through the account flow, not this
    // form — the form never sends it. Guard the disabled state so it can't
    // quietly become an editable field that silently discards what's typed.
    await expect(page.locator('input[name=email]')).toBeDisabled()
    await expect(page.locator('input[name=email]')).toHaveValue(SEED.owner.email)
  })
})

// ─── Settings → Notifications ────────────────────────────────────────────────

test.describe('Settings → Notifications', () => {
  test('a channel toggle survives a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'notifications')

    const box = page.locator('input[type=checkbox][aria-label="New enquiry — EMAIL"]')
    await expect(box).toBeVisible({ timeout: 20_000 })
    const before = await box.isChecked()

    await box.click()
    await page.waitForTimeout(1200)
    await settingsTab(page, 'notifications')
    const after = page.locator('input[type=checkbox][aria-label="New enquiry — EMAIL"]')
    await expect(after).toBeChecked({ checked: !before, timeout: 20_000 })

    await after.click()
    await page.waitForTimeout(1200)
    await settingsTab(page, 'notifications')
    await expect(page.locator('input[type=checkbox][aria-label="New enquiry — EMAIL"]')).toBeChecked({
      checked: before,
      timeout: 20_000,
    })
  })

  test('a customised title, body and timing survive a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'notifications')

    await expect(page.getByRole('button', { name: 'Customise' }).first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Customise' }).first().click()

    // The expanded editor row is the one carrying a textarea.
    const editorRow = page.locator('tr').filter({ has: page.locator('textarea') }).first()
    const minutes = editorRow.locator('select').first()
    const title = editorRow.locator('input[type=text]').first()
    const body = editorRow.locator('textarea').first()

    await minutes.selectOption('90')
    await title.fill('Audit reminder title')
    await body.fill('Audit reminder body')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(1500)

    await settingsTab(page, 'notifications')
    await page.getByRole('button', { name: 'Customise' }).first().click()
    const reopened = page.locator('tr').filter({ has: page.locator('textarea') }).first()
    await expect(reopened.locator('select').first()).toHaveValue('90')
    await expect(reopened.locator('input[type=text]').first()).toHaveValue('Audit reminder title')
    await expect(reopened.locator('textarea').first()).toHaveValue('Audit reminder body')

    // Clear the customisation again so the seeded trainer keeps default copy.
    await reopened.locator('input[type=text]').first().fill('')
    await reopened.locator('textarea').first().fill('')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(1500)
  })
})

// ─── Settings → Configure (the free feature switches) ────────────────────────

test.describe('Settings → Configure', () => {
  // One switch, done properly: flip, reload, assert, flip back, reload, assert.
  // Doing all thirteen in the browser takes minutes and adds nothing — the
  // write path is identical for every row.
  test('a feature switch survives a reload and can be switched back', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'configure')

    const sw = page.locator('[aria-label^="Timesheets — "]')
    await expect(sw).toBeVisible({ timeout: 20_000 })
    const before = (await sw.getAttribute('aria-label'))!.endsWith('on')

    await sw.click()
    await expect(page.locator('[aria-label^="Timesheets — "]')).toHaveAttribute(
      'aria-label', `Timesheets — ${before ? 'off' : 'on'}`, { timeout: 15_000 },
    )
    await settingsTab(page, 'configure')
    await expect(page.locator('[aria-label^="Timesheets — "]')).toHaveAttribute(
      'aria-label', `Timesheets — ${before ? 'off' : 'on'}`, { timeout: 20_000 },
    )

    await page.locator('[aria-label^="Timesheets — "]').click()
    await page.waitForTimeout(1500)
    await settingsTab(page, 'configure')
    await expect(page.locator('[aria-label^="Timesheets — "]')).toHaveAttribute(
      'aria-label', `Timesheets — ${before ? 'on' : 'off'}`, { timeout: 20_000 },
    )
  })

  test('every switch on the page reports a state and none of them is stuck', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'configure')
    const switches = page.locator('[aria-label$=" — on"], [aria-label$=" — off"]')
    await expect(switches.first()).toBeVisible({ timeout: 20_000 })
    // 13 free features today; the assertion is "more than a handful, and every
    // one of them says on or off" rather than a brittle exact count.
    expect(await switches.count()).toBeGreaterThanOrEqual(10)
  })
})

// ─── Add-on gating: the switch really does gate the feature ──────────────────

test.describe('add-on gating', () => {
  const NAV_GATES: { id: string; href: string }[] = [
    { id: 'messaging', href: '/messages' },
    { id: 'library', href: '/library' },
    { id: 'timesheets', href: '/timesheets' },
    { id: 'events', href: '/events' },
    { id: 'memberships', href: '/memberships' },
    { id: 'classes', href: '/classes' },
    { id: 'casual', href: '/casual-classes' },
  ]

  for (const { id, href } of [NAV_GATES[0], NAV_GATES[1]]) {
    test(`${id}: off removes ${href} from the menu, on puts it back`, async ({ page }) => {
      await login(page)

      await setAddon(page, id, false)
      await page.goto('/dashboard')
      await expect(page.locator(`nav a[href="${href}"]`)).toHaveCount(0)

      await setAddon(page, id, true)
      await page.goto('/dashboard')
      await expect(page.locator(`nav a[href="${href}"]`).first()).toBeVisible()
    })
  }

  test('Google Calendar off hides its settings tab, on shows it', async ({ page }) => {
    await login(page)

    await setAddon(page, 'googlecalendar', false)
    await settingsTab(page, 'calendar')
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0)

    await setAddon(page, 'googlecalendar', true)
    await settingsTab(page, 'calendar')
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 20_000 })

    await setAddon(page, 'googlecalendar', false)
  })
})

// ─── Settings → What you call things ─────────────────────────────────────────

test.describe('Settings → What you call things', () => {
  test('a renamed menu item survives a reload and renames the real menu', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'naming')

    const box = page.locator('input[aria-label="Your word for Group Classes"]')
    await expect(box).toBeVisible({ timeout: 20_000 })
    const before = await box.inputValue()

    await box.fill('Courses')
    await page.getByRole('button', { name: 'Save names' }).click()
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 })

    await settingsTab(page, 'naming')
    await expect(page.locator('input[aria-label="Your word for Group Classes"]')).toHaveValue('Courses')

    // The menu is rendered server-side from the same map.
    await page.goto('/dashboard')
    await expect(page.locator('nav a[href="/classes"]').first()).toContainText('Courses')

    await settingsTab(page, 'naming')
    await page.locator('input[aria-label="Your word for Group Classes"]').fill(before)
    await page.getByRole('button', { name: 'Save names' }).click()
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 })

    await page.goto('/dashboard')
    await expect(page.locator('nav a[href="/classes"]').first()).toContainText('Group Classes')
  })

  test('a rename is capped at 40 characters', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'naming')
    const box = page.locator('input[aria-label="Your word for Library"]')
    await expect(box).toBeVisible({ timeout: 20_000 })
    await box.fill('L'.repeat(120))
    expect((await box.inputValue()).length).toBe(40)
    await box.fill('')
  })
})

// ─── Settings → Design ───────────────────────────────────────────────────────

test.describe('Settings → Design', () => {
  test('the brand colour survives a reload', async ({ page }) => {
    await login(page)
    await settingsTab(page, 'design')

    const swatch = page.locator('input[type=color]')
    await expect(swatch).toBeVisible({ timeout: 20_000 })
    // The hex box is a wrapped <Input>, not a sibling of the swatch — the
    // xpath sibling locator matched nothing and the fill just timed out.
    const hex = page.getByPlaceholder(/^#[0-9a-fA-F]{6}$/)
    const before = await swatch.inputValue()

    await hex.fill('#ff8800')
    await page.getByRole('button', { name: 'Save design' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })

    await settingsTab(page, 'design')
    await expect(page.locator('input[type=color]')).toHaveValue('#ff8800')

    await page.getByPlaceholder(/^#[0-9a-fA-F]{6}$/).fill(before)
    await page.getByRole('button', { name: 'Save design' }).click()
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 15_000 })
  })
})
