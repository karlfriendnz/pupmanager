import { test, expect } from '@playwright/test'
import { login, tab } from './helpers'

test.describe.configure({ mode: 'serial' })

const read = (page: any) => page.evaluate(() => {
  const v = (sel: string) => { const e = document.querySelector(sel) as HTMLInputElement | null; return e ? e.value : '__missing__' }
  const c = (sel: string) => { const e = document.querySelector(sel) as HTMLInputElement | null; return e ? e.checked : null }
  const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]
  const cur = selects.find(s => !s.name)
  return {
    name: v('input[name=name]'), email: v('input[name=email]'),
    emailDisabled: (document.querySelector('input[name=email]') as HTMLInputElement | null)?.disabled,
    businessName: v('input[name=businessName]'), phone: v('input[name=phone]'),
    showPhone: c('input[name=showPhoneToClients]'),
    publicEmail: v('input[name=publicEmail]'),
    signupCountry: v('select[name=signupCountry]'),
    timezone: v('select[name=timezone]'), landingPage: v('select[name=landingPage]'),
    currency: cur ? cur.value : '__none__',
    roles: (Array.from(document.querySelectorAll('button[aria-pressed]')) as HTMLElement[]).map(b => b.innerText.trim() + '=' + b.getAttribute('aria-pressed')),
  }
})

test('profile tab persistence', async ({ page }) => {
  const reqs: string[] = []
  page.on('response', r => { if (r.url().includes('/api/')) reqs.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  await login(page)
  await tab(page, 'profile')
  console.log('BEFORE', JSON.stringify(await read(page)))

  await page.fill('input[name=name]', 'Audit Renamed')
  await page.fill('input[name=businessName]', 'Audit Biz Renamed')
  await page.fill('input[name=phone]', '+64 21 000 1111')
  await page.check('input[name=showPhoneToClients]')
  await page.fill('input[name=publicEmail]', 'public@pupaudit.test')
  await page.selectOption('select[name=signupCountry]', 'GB')
  await page.selectOption('select[name=timezone]', 'Europe/London')
  await page.selectOption('select[name=landingPage]', 'schedule')
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-pressed]')) as HTMLElement[]
    btns[0] && btns[0].click(); btns[3] && btns[3].click()
  })
  await page.evaluate(() => {
    const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => (x.innerText||'').includes('Save business details'))
    b && b.click()
  })
  await page.waitForTimeout(3500)
  console.log('REQS', JSON.stringify(reqs))
  console.log('BANNER', await page.evaluate(() => (document.body.innerText.match(/Saved!|Failed to save/) || ['none'])[0]))

  await tab(page, 'profile')
  console.log('AFTER', JSON.stringify(await read(page)))
})
