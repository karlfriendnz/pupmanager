import { test, expect } from '@playwright/test'
import { login, tab } from './helpers'
test.describe.configure({ mode: 'serial' })

test('base currency saves instantly + survives reload', async ({ page }) => {
  const reqs: string[] = []
  page.on('response', r => { if (r.url().includes('/api/')) reqs.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  await login(page)
  await tab(page, 'profile')
  const sel = page.locator('select').filter({ hasNot: page.locator('[name]') })
  // currency select is the one with no name attribute
  const cur = await page.evaluate(() => {
    const s = (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find(x => !x.name)
    return s ? { value: s.value, opts: Array.from(s.options).map(o => o.value) } : null
  })
  console.log('CURRENCY BEFORE', JSON.stringify(cur))
  await page.evaluate(() => {
    const s = (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find(x => !x.name)!
    s.value = 'gbp'
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(2500)
  console.log('REQS', JSON.stringify(reqs.filter(r => !r.includes('auth') && !r.includes('stream'))))
  await tab(page, 'profile')
  const after = await page.evaluate(() => (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find(x => !x.name)!.value)
  console.log('CURRENCY AFTER RELOAD', after)
})

test('profile validation: empty required, long string, emoji, html, bad email', async ({ page }) => {
  await login(page)
  await tab(page, 'profile')
  // empty required
  await page.fill('input[name=name]', '')
  await page.fill('input[name=businessName]', '')
  await page.fill('input[name=phone]', '')
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details')); b && b.click() })
  await page.waitForTimeout(1500)
  console.log('EMPTY-ERRORS', await page.evaluate(() => (document.body.innerText.match(/.*(is required|Enter a valid|real business name).*/g) || []).join(' | ')))

  // bad public email
  await page.fill('input[name=name]', 'Audit Renamed')
  await page.fill('input[name=businessName]', 'Audit Biz Renamed')
  await page.fill('input[name=phone]', '+64 21 000 1111')
  await page.fill('input[name=publicEmail]', 'not-an-email')
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details')); b && b.click() })
  await page.waitForTimeout(1500)
  console.log('BADEMAIL-ERRORS', await page.evaluate(() => (document.body.innerText.match(/Enter a valid email/g) || []).join(' | ')))

  // long + emoji + html in business name
  const long = 'X'.repeat(5000)
  await page.fill('input[name=publicEmail]', '')
  await page.fill('input[name=businessName]', long)
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details')); b && b.click() })
  await page.waitForTimeout(2500)
  console.log('LONG-BANNER', await page.evaluate(() => (document.body.innerText.match(/Saved!|Failed to save/) || ['none'])[0]))
  await tab(page, 'profile')
  console.log('LONG-AFTER len=', await page.evaluate(() => (document.querySelector('input[name=businessName]') as HTMLInputElement).value.length))

  await page.fill('input[name=businessName]', '<script>alert(1)</script> Ünïcode 🐶 مرحبا')
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details')); b && b.click() })
  await page.waitForTimeout(2500)
  await tab(page, 'profile')
  console.log('HTML-AFTER', await page.evaluate(() => (document.querySelector('input[name=businessName]') as HTMLInputElement).value))
  console.log('HEADER-RENDER', await page.evaluate(() => document.body.innerHTML.includes('<script>alert(1)</script>')))
  // restore
  await page.fill('input[name=businessName]', 'Audit Biz Renamed')
  await page.evaluate(() => { const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details')); b && b.click() })
  await page.waitForTimeout(2000)
})
