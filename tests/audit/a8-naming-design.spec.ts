import { test, expect } from '@playwright/test'
import { tab } from './helpers'
test.describe.configure({ mode: 'serial' })

test('naming: rename persists and changes the nav; reset works; maxlength', async ({ page }) => {
  test.setTimeout(400000)
  await tab(page, 'naming'); await page.waitForTimeout(2000)
  const inputs = page.locator('input[aria-label^="Your word for"]')
  const n = await inputs.count()
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('input[aria-label^="Your word for"]')).map(i => i.getAttribute('aria-label')))
  console.log('NAMING INPUTS', n, JSON.stringify(labels))
  // rename the /clients item (index 1) and Group Classes
  await inputs.nth(1).fill('Guardians')
  const gcIdx = labels.indexOf('Your word for Group Classes')
  await inputs.nth(gcIdx).fill('Courses')
  // maxlength probe on Library
  const libIdx = labels.indexOf('Your word for Library')
  await inputs.nth(libIdx).fill('L'.repeat(120))
  const libLen = (await inputs.nth(libIdx).inputValue()).length
  console.log('MAXLENGTH clamp ->', libLen)
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Save names'); b && b.click() })
  await page.waitForTimeout(3000)
  await tab(page, 'naming'); await page.waitForTimeout(2500)
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('input[aria-label^="Your word for"]')).map(i => [i.getAttribute('aria-label'), (i as HTMLInputElement).value]))
  console.log('AFTER RELOAD', JSON.stringify(after))
  const nav = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') + '::' + (a as HTMLElement).innerText.trim()).filter(x => /\/clients|\/classes|\/library/.test(x)))
  console.log('NAV AFTER RENAME', JSON.stringify(Array.from(new Set(nav))))
  // reset everything
  await page.evaluate(() => {
    document.querySelectorAll('input[aria-label^="Your word for"]').forEach(i => {
      const e = i as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true }))
    })
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Save names'); b && b.click() })
  await page.waitForTimeout(3000)
  await tab(page, 'naming'); await page.waitForTimeout(2000)
  console.log('AFTER RESET', await page.evaluate(() => Array.from(document.querySelectorAll('input[aria-label^="Your word for"]')).map(i => (i as HTMLInputElement).value).join('|')))
})

test('design: brand colour + home-screen lockup persist', async ({ page }) => {
  test.setTimeout(400000)
  await tab(page, 'design'); await page.waitForTimeout(2500)
  const before = await page.evaluate(() => ({
    color: (document.querySelector('input[type=color]') as HTMLInputElement)?.value,
    hexText: (Array.from(document.querySelectorAll('input[type=text]')) as HTMLInputElement[]).map(i => ({ ph: i.placeholder, v: i.value })),
    lockup: (Array.from(document.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[]).map(i => i.checked),
  }))
  console.log('DESIGN BEFORE', JSON.stringify(before))
  // hex text field
  const hex = page.locator('input[type=text]').first()
  await hex.fill('#ff8800')
  await page.waitForTimeout(400)
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Save design'); b && b.click() })
  await page.waitForTimeout(3000)
  console.log('BANNER', await page.evaluate(() => (document.body.innerText.match(/Saved!|Failed to save/) || ['none'])[0]))
  await tab(page, 'design'); await page.waitForTimeout(2500)
  console.log('DESIGN AFTER', await page.evaluate(() => ({
    color: (document.querySelector('input[type=color]') as HTMLInputElement)?.value,
    hexText: (document.querySelector('input[type=text]') as HTMLInputElement)?.value,
    hexPlaceholder: (document.querySelector('input[type=text]') as HTMLInputElement)?.placeholder,
  })))
  // invalid hex
  await hex.fill('not-a-colour')
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Save design'); b && b.click() })
  await page.waitForTimeout(2500)
  console.log('INVALID HEX RESULT', await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').match(/.{0,90}(Saved!|Failed to save|Invalid|valid).{0,60}/)?.[0] || 'no message'))
  // lockup toggle
  await tab(page, 'design'); await page.waitForTimeout(2500)
  const cb = page.locator('input[type=checkbox]').first()
  const was = await cb.isChecked()
  await cb.click()
  await page.waitForTimeout(2500)
  await tab(page, 'design'); await page.waitForTimeout(2500)
  const now = await page.locator('input[type=checkbox]').first().isChecked()
  console.log('LOCKUP', { was, now, persisted: now !== was })
})
