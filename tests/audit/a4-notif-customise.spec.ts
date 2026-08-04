import { test, expect } from '@playwright/test'
import { tab } from './helpers'

test('customise: minutes + title + body persist', async ({ page }) => {
  test.setTimeout(180000)
  const puts: any[] = []
  page.on('request', r => {
    if (r.url().includes('notification-preferences') && r.method() === 'PUT') {
      try { puts.push(JSON.parse(r.postData() || '{}')) } catch {}
    }
  })
  const openFirst = async () => {
    await tab(page, 'notifications')
    await page.waitForTimeout(3500)
    await page.evaluate(() => {
      const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Customise')
      b && b.click()
    })
    await page.waitForTimeout(1500)
  }
  await openFirst()
  const titleSel = 'tr.bg-slate-50\\/50 input[type=text]'
  const titles = page.locator('tr').filter({ has: page.locator('textarea') }).locator('input[type=text]')
  const n = await titles.count()
  console.log('title inputs found', n)
  await titles.nth(0).click()
  await titles.nth(0).fill('AUDIT TITLE')
  console.log('typed value', await titles.nth(0).inputValue())
  await page.keyboard.press('Tab')
  await page.waitForTimeout(2500)
  const ta = page.locator('tr').filter({ has: page.locator('textarea') }).locator('textarea').first()
  await ta.click()
  await ta.fill('AUDIT BODY')
  console.log('typed body', await ta.inputValue())
  await page.keyboard.press('Tab')
  await page.waitForTimeout(3000)
  console.log('PUT BODIES', JSON.stringify(puts.map(p => ({ t: p.type, c: p.channel, title: p.customTitle, body: (p.customBody||'').slice(0,40), min: p.minutesBefore }))))
  console.log('SAVED MARKERS', await page.evaluate(() => (document.body.innerText.match(/Saved|Save failed|failed/gi) || []).join(',')))
  await openFirst()
  const after = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.className.includes('bg-slate-50/50'))!
    return {
      minutes: (row.querySelectorAll('select')[0] as HTMLSelectElement).value,
      title: (row.querySelectorAll('input[type=text]')[0] as HTMLInputElement).value,
      body: (row.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? null,
      editorHtml: (row.querySelector('[contenteditable=true]') as HTMLElement | null)?.innerHTML?.slice(0, 120) ?? null,
    }
  })
  console.log('AFTER RELOAD', JSON.stringify(after))
})
