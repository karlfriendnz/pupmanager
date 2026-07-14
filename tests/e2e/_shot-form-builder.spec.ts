import { test, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Dev utility (underscore-prefixed → excluded from the suite): screenshots the
// session form builder modal at desktop + mobile widths.

const OUT = '/Users/karl/Desktop/Temp'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

async function buildForm(page: Page) {
  // Both shots share one seeded DB — only add the demo fields once.
  const existing: { label: string }[] = await (await page.request.get('/api/custom-fields')).json()
  const have = new Set(existing.map(f => f.label))
  const demo = [
    { label: 'Recall confidence', type: 'DROPDOWN', appliesTo: 'DOG', options: ['Low', 'Medium', 'High'] },
    { label: 'Reactivity notes', type: 'TEXT', appliesTo: 'DOG' },
    { label: 'Preferred contact time', type: 'TEXT', appliesTo: 'OWNER' },
  ]
  for (const f of demo) {
    if (!have.has(f.label)) await page.request.post('/api/custom-fields', { data: f })
  }

  await page.goto('/settings?tab=forms&view=forms')
  await page.getByRole('button', { name: 'New session form' }).click()
  const modal = page.getByRole('dialog', { name: 'Session form builder' })
  await modal.getByLabel('Form name').fill('First session report')

  // Mobile: the palette lives in a bottom sheet that starts closed.
  const openSheet = modal.getByRole('button', { name: 'Add question' })
  if (await openSheet.isVisible()) await openSheet.click()

  await modal.getByRole('button', { name: 'Add Long text' }).click()
  await modal.getByPlaceholder('e.g. How did the session go?').fill('How did the session go?')
  await modal.getByLabel('Back to palette').click()

  await modal.getByRole('button', { name: 'Add Rating 1–5' }).click()
  await modal.getByPlaceholder('e.g. How did the session go?').fill('Focus around distractions')
  await modal.getByLabel('Back to palette').click()

  await modal.getByRole('button', { name: 'Add Radio' }).click()
  await modal.getByPlaceholder('e.g. How did the session go?').fill('Overall mood')
  await modal.getByLabel('Options').fill('Relaxed\nExcitable\nAnxious')
  await modal.getByLabel('Back to palette').click()

  await modal.getByRole('button', { name: 'Add field Recall confidence' }).click()
  await modal.getByLabel('Back to palette').click()

  await modal.getByRole('button', { name: 'Add Short text' }).click()
  await modal.getByPlaceholder('e.g. How did the session go?').fill('Homework for this week')
  await modal.getByLabel('Private').click()
  return modal
}

test('shot: builder desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  await buildForm(page)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/pm-form-builder-desktop.png` })
  // And the palette view (nothing selected).
  await page.getByRole('dialog').getByLabel('Back to palette').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/pm-form-builder-desktop-palette.png` })
})

test('shot: builder mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const modal = await buildForm(page)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/pm-form-builder-mobile-editor.png` })
  await modal.getByLabel('Back to palette').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/pm-form-builder-mobile-palette.png` })
  // Tap the scrim above the sheet → sheet closes, canvas + "Add question" bar.
  await page.mouse.click(195, 150)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/pm-form-builder-mobile-canvas.png` })
})
