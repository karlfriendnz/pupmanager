import { test, expect } from '@playwright/test'
import { tab } from './helpers'
test.describe.configure({ mode: 'serial' })

const snap = (page: any) => page.evaluate(() => {
  const out: Record<string, boolean> = {}
  document.querySelectorAll('input[type=checkbox][aria-label]').forEach(el => {
    const e = el as HTMLInputElement
    out[e.getAttribute('aria-label')!] = e.checked
  })
  return out
})

test('notification toggles persist', async ({ page }) => {
  test.setTimeout(180000)
  const reqs: string[] = []
  page.on('response', r => { if (r.url().includes('notification-preferences')) reqs.push(`${r.status()} ${r.request().method()}`) })
  await tab(page, 'notifications')
  await page.waitForTimeout(3000)
  const before = await snap(page)
  console.log('COUNT', Object.keys(before).length)
  console.log('BEFORE', JSON.stringify(before))

  // flip every one
  const labels = Object.keys(before)
  for (const l of labels) {
    await page.evaluate((lab) => {
      const e = document.querySelector(`input[type=checkbox][aria-label="${lab}"]`) as HTMLInputElement
      e && e.click()
    }, l)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(3000)
  const mid = await snap(page)
  console.log('AFTER-FLIP (in memory)', JSON.stringify(mid))
  await tab(page, 'notifications')
  await page.waitForTimeout(3500)
  const after = await snap(page)
  const bad = labels.filter(l => after[l] !== !before[l])
  console.log('NOT PERSISTED:', JSON.stringify(bad))
  console.log('REQ STATUSES', JSON.stringify(Array.from(new Set(reqs))))

  // flip back
  for (const l of labels) {
    await page.evaluate((lab) => {
      const e = document.querySelector(`input[type=checkbox][aria-label="${lab}"]`) as HTMLInputElement
      if (e) e.click()
    }, l)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(3000)
  await tab(page, 'notifications')
  await page.waitForTimeout(3500)
  const restored = await snap(page)
  console.log('RESTORE OK', JSON.stringify(labels.filter(l => restored[l] !== before[l])))
})

test('customise row: timing + wording persist', async ({ page }) => {
  test.setTimeout(180000)
  await tab(page, 'notifications')
  await page.waitForTimeout(3000)
  // open the first Customise
  await page.evaluate(() => {
    const b = (Array.from(document.querySelectorAll('button')) as HTMLElement[]).find(x => x.innerText.trim() === 'Customise')
    b && b.click()
  })
  await page.waitForTimeout(1500)
  const controls = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr')).filter(r => r.className.includes('bg-slate-50/50'))
    const r = rows[0]
    if (!r) return null
    return {
      html: (r as HTMLElement).innerText.slice(0, 600),
      selects: Array.from(r.querySelectorAll('select')).map(s => ({ v: (s as HTMLSelectElement).value, opts: Array.from((s as HTMLSelectElement).options).slice(0,4).map(o => o.value) })),
      inputs: Array.from(r.querySelectorAll('input')).map(i => ({ t: (i as HTMLInputElement).type, ph: (i as HTMLInputElement).placeholder, v: (i as HTMLInputElement).value })),
    }
  })
  console.log('CUSTOMISE', JSON.stringify(controls, null, 1))
})
