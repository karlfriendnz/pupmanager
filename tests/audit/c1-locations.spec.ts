import { test, expect } from '@playwright/test'
import { tab } from './helpers'
test.describe.configure({ mode: 'serial' })
const T = { timeout: 20000 }

test('locations: validation, create, persist, edit, delete', async ({ page }) => {
  test.setTimeout(300000)
  await tab(page, 'locations'); await page.waitForTimeout(2500)
  // The trigger and the submit carry the SAME label ("Add location") — the
  // submit is the last one on screen once the draft opens.
  await page.locator('button:visible', { hasText: 'Add location' }).last().click(T)
  await page.waitForTimeout(1200)

  const submit = () => page.locator('button:visible').filter({ hasText: /^Add location$|^Save changes$/ }).last()
  await submit().click(T)
  await page.waitForTimeout(1500)
  console.log('EMPTY NAME ERROR ->', await page.evaluate(() => document.body.innerText.includes('Give the location a name.')))

  const name = 'Audit Field ' + Date.now()
  await page.locator('input[placeholder="The training field"]:visible').fill(name, T)
  await page.locator('textarea[placeholder^="Parking round"]:visible').fill('Gate code 1234 🐶 <b>bold</b>', T)
  await submit().click(T)
  await page.waitForTimeout(3500)

  await tab(page, 'locations'); await page.waitForTimeout(2500)
  console.log('CREATED + PERSISTED ->', await page.evaluate((n) => document.body.innerText.includes(n), name))
  console.log('DESCRIPTION SHOWN ->', await page.evaluate(() => document.body.innerText.includes('Gate code 1234')))
  console.log('HTML ESCAPED ->', await page.evaluate(() => !document.body.innerHTML.includes('Gate code 1234 🐶 <b>bold</b>')))

  await page.locator('button[aria-label="Edit location"]:visible').last().click(T)
  await page.waitForTimeout(1200)
  await page.locator('input[placeholder="The training field"]:visible').fill(name + ' EDITED', T)
  await submit().click(T)
  await page.waitForTimeout(3500)
  await tab(page, 'locations'); await page.waitForTimeout(2500)
  console.log('EDIT PERSISTED ->', await page.evaluate((n) => document.body.innerText.includes(n + ' EDITED'), name))

  await page.locator('button[aria-label="Delete location"]:visible').last().click(T)
  await page.waitForTimeout(900)
  const confirm = page.locator('button:visible').filter({ hasText: /Delete|Remove|Yes/ }).last()
  if (await confirm.count()) { await confirm.click(T); await page.waitForTimeout(3000) }
  await tab(page, 'locations'); await page.waitForTimeout(2500)
  console.log('DELETED ->', await page.evaluate((n) => !document.body.innerText.includes(n), name))
})

test('no horizontal overflow on any settings tab at 390px and 1440px', async ({ page }) => {
  test.setTimeout(900000)
  const TABS = ['profile', 'design', 'notifications', 'configure', 'naming', 'addons', 'forms', 'locations', 'integrations', 'emails', 'team', 'billing', 'activity']
  for (const w of [390, 1440]) {
    await page.setViewportSize({ width: w, height: 844 })
    for (const t of TABS) {
      await tab(page, t); await page.waitForTimeout(1500)
      const r = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth, winW: window.innerWidth,
        widest: (() => {
          let worst = ''; let max = 0
          document.querySelectorAll('*').forEach(e => {
            const b = e.getBoundingClientRect()
            if (b.right > max) { max = b.right; worst = e.tagName + '.' + (e.className || '').toString().slice(0, 60) }
          })
          return { max: Math.round(max), worst }
        })(),
      }))
      console.log(`W=${w} ${t}: docW=${r.docW} winW=${r.winW} overflow=${r.docW > r.winW + 1} rightmost=${r.widest.max} ${r.docW > r.winW + 1 ? r.widest.worst : ''}`)
    }
  }
})
