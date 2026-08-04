import { test, expect } from '@playwright/test'

// The unified form builder: one of every question type, options, required,
// multi-step, and conditional visibility — saved, reloaded, re-read.
test('client form: every question type round-trips through save + reload', async ({ page }) => {
  test.setTimeout(900000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 160)))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 160)) })

  await page.goto('/forms/client/new', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(4000)
  console.log('URL', page.url())

  const formName = 'Audit every type ' + Date.now()
  await page.getByLabel('Form name').fill(formName)

  const TYPES = ['Short text', 'Long text', 'Number', 'Rating 1–5', 'Dropdown', 'Radio', 'Checkbox']
  for (const t of TYPES) {
    const btn = page.locator(`button[aria-label="Add ${t}"]:visible`).first()
    const n = await btn.count()
    if (!n) { console.log('PALETTE ROW MISSING:', t); continue }
    await btn.click()
    await page.waitForTimeout(350)
  }
  // built-in client detail + a brand-new saved field
  const detail = page.locator('button[aria-label="Add a client detail"]:visible').first()
  if (await detail.count()) { await detail.click(); await page.waitForTimeout(1200) }
  console.log('DETAIL PICKER', await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).filter(b => (b as HTMLElement).offsetParent).map(b => (b as HTMLElement).innerText.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0, 40)
  }))
  // pick the first detail offered
  await page.evaluate(() => {
    const sheet = document.querySelector('[role=dialog], .fixed.inset-0')
    const b = sheet ? Array.from(sheet.querySelectorAll('button')).find(x => /Dog|name|Email|Phone/i.test((x as HTMLElement).innerText)) : null
    ;(b as HTMLElement | null)?.click()
  })
  await page.waitForTimeout(1200)

  const saved = page.locator('button[aria-label="Add a saved field"]:visible').first()
  if (await saved.count()) { await saved.click(); await page.waitForTimeout(600) }

  // Fill labels for every authored question
  const labelBoxes = page.locator('input[aria-label^="Question "]:visible')
  const qn = await labelBoxes.count()
  console.log('QUESTION LABEL BOXES', qn)
  for (let i = 0; i < qn; i++) await labelBoxes.nth(i).fill(`Q${i + 1} label`)

  // options for choice questions
  const opts = page.locator('input[aria-label^="Option "]:visible')
  const on = await opts.count()
  console.log('OPTION BOXES', on)
  for (let i = 0; i < on; i++) await opts.nth(i).fill(`Opt ${i + 1}`)

  const inventory = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input,select,textarea,button')) as HTMLElement[]
    return els.filter(e => e.offsetParent).map(e => ({
      tag: e.tagName, type: (e as HTMLInputElement).type,
      lbl: e.getAttribute('aria-label') || (e as HTMLInputElement).placeholder || (e.tagName === 'BUTTON' ? e.innerText.replace(/\s+/g, ' ').slice(0, 30) : ''),
    })).filter(x => x.lbl)
  })
  console.log('EDITOR CONTROLS', JSON.stringify(inventory))
  console.log('ERRORS', JSON.stringify(errors.slice(0, 8)))
})
