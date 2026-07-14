import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Owner happy path for the two-pane session form builder modal:
// Settings → Fields & forms → Forms → "New session form" → add a question from
// the palette AND one of the trainer's existing fields → reorder → save →
// the form shows in the list and survives a reload.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('session form builder — owner happy path', () => {
  test('owner builds a session form in the modal and it persists', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Give the owner a field to pull in from the "Your fields" palette group.
    const fieldLabel = `Confidence ${Date.now()}`
    const created = await page.request.post('/api/custom-fields', {
      data: { label: fieldLabel, type: 'TEXT', appliesTo: 'DOG' },
    })
    expect(created.ok()).toBeTruthy()

    await page.goto('/settings?tab=forms&view=forms')
    await page.getByRole('button', { name: 'New session form' }).click()

    const modal = page.getByRole('dialog', { name: 'Session form builder' })
    await expect(modal).toBeVisible()

    const formName = `Builder form ${Date.now()}`
    await modal.getByLabel('Form name').fill(formName)

    // Empty canvas prompts for a drop.
    await expect(modal.getByText('Drag questions here, or click + on the left')).toBeVisible()

    // 1. Add a question type from the palette — it auto-selects, so the left
    //    pane flips to the question editor.
    await modal.getByRole('button', { name: 'Add Long text' }).click()
    await expect(modal.getByLabel('Back to palette')).toBeVisible()
    await modal.getByPlaceholder('e.g. How did the session go?').fill('How did the session go?')
    await expect(modal.getByRole('button', { name: /Edit question: How did the session go\?/ })).toBeVisible()

    // 2. Back to the palette, then add one of the trainer's existing fields.
    await modal.getByLabel('Back to palette').click()
    await modal.getByRole('button', { name: `Add field ${fieldLabel}` }).click()
    await expect(modal.getByRole('button', { name: `Edit question: ${fieldLabel}` })).toBeVisible()

    // The field can't be added twice — it's dimmed and tagged "Added".
    await modal.getByLabel('Back to palette').click()
    const addedRow = modal.getByRole('button', { name: `${fieldLabel} (added)` })
    await expect(addedRow).toBeVisible()
    await expect(addedRow).toBeDisabled()

    // Canvas order right now: [Long text, linked field].
    const rows = modal.locator('[data-question-row]')
    await expect(rows).toHaveCount(2)

    // 3. Reorder — drag the linked field above the long-text question.
    const handles = modal.getByRole('button', { name: 'Reorder question' })
    const source = handles.nth(1)
    const targetBox = await rows.nth(0).boundingBox()
    const sourceBox = await source.boundingBox()
    if (!targetBox || !sourceBox) throw new Error('missing drag geometry')
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 12 })
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y - 8, { steps: 6 })
    await page.mouse.up()

    await expect(rows.nth(0)).toContainText(fieldLabel)
    await expect(rows.nth(1)).toContainText('How did the session go?')

    // 4. Save — the modal closes and the form joins the list.
    // dnd-kit keeps a capture-phase `click` → stopPropagation listener on the
    // document for 50ms after a drop, so a click fired immediately after
    // mouse.up() is swallowed. A human can't click that fast; the test can.
    await page.waitForTimeout(150)
    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/session-forms') && r.request().method() === 'POST'),
      modal.getByRole('button', { name: 'Save' }).click(),
    ])
    expect(res.ok()).toBeTruthy()

    await expect(modal).toBeHidden()
    await expect(page.getByText(formName)).toBeVisible({ timeout: 10_000 })

    // 5. It persists — and kept the dragged order.
    await page.reload()
    await expect(page.getByText(formName)).toBeVisible()
    await expect(page.getByText(formName).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]'))
      .toContainText('2 questions')

    const forms = await (await page.request.get('/api/session-forms')).json()
    const saved = forms.find((f: { name: string }) => f.name === formName)
    expect(saved).toBeTruthy()
    expect(saved.questions.map((q: { type: string }) => q.type)).toEqual(['CUSTOM_FIELD', 'LONG_TEXT'])
  })

  test('the builder refuses to save an unnamed form', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings?tab=forms&view=forms')
    await page.getByRole('button', { name: 'New session form' }).click()

    const modal = page.getByRole('dialog', { name: 'Session form builder' })
    await modal.getByRole('button', { name: 'Add Short text' }).click()
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal.getByText('Give the form a name')).toBeVisible()
    await expect(modal).toBeVisible()
  })
})
