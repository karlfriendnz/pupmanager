import { test, expect } from '@playwright/test'
import { tab } from './helpers'

const state = (page: any, name: string) => page.evaluate((n: string) => {
  const el = document.querySelector(`[aria-label^="${n} — "]`)
  return el ? (el.getAttribute('aria-label')!.endsWith('on') ? 'on' : 'off') : 'missing'
}, name)

const all = (page: any) => page.evaluate(() => {
  const out: Record<string, string> = {}
  document.querySelectorAll('[aria-label]').forEach(el => {
    const l = el.getAttribute('aria-label')!
    if (!/ — (on|off)$/.test(l)) return
    out[l.replace(/ — (on|off)$/, '')] = l.endsWith('on') ? 'on' : 'off'
  })
  return out
})

async function flipAndWait(page: any, name: string) {
  const from = await state(page, name)
  const want = from === 'on' ? 'off' : 'on'
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate((n: string) => {
      const el = document.querySelector(`[aria-label^="${n} — "]`) as HTMLButtonElement | null
      if (!el || el.disabled) return false
      el.click(); return true
    }, name)
    if (clicked) {
      try { await page.waitForFunction(([n, w]: any) => {
        const el = document.querySelector(`[aria-label^="${n} — "]`)
        return !!el && el.getAttribute('aria-label')!.endsWith(w)
      }, [name, want], { timeout: 8000 }) } catch {}
    }
    if (await state(page, name) === want) return true
    await page.waitForTimeout(1200)
  }
  return false
}

test('configure toggles persist individually', async ({ page }) => {
  test.setTimeout(900000)
  await tab(page, 'configure'); await page.waitForTimeout(2000)
  const before = await all(page)
  const names = Object.keys(before)
  console.log('BEFORE', JSON.stringify(before))
  const results: any[] = []
  for (const n of names) {
    await tab(page, 'configure'); await page.waitForTimeout(1800)
    const from = await state(page, n)
    const flipped = await flipAndWait(page, n)
    await page.waitForTimeout(1500)
    await tab(page, 'configure'); await page.waitForTimeout(1800)
    const persisted = await state(page, n)
    const want = from === 'on' ? 'off' : 'on'
    results.push({ name: n, from, uiFlipped: flipped, afterReload: persisted, ok: persisted === want })
    // flip back
    if (persisted !== from) { await flipAndWait(page, n); await page.waitForTimeout(1200) }
  }
  for (const r of results) console.log('RESULT', JSON.stringify(r))
  await tab(page, 'configure'); await page.waitForTimeout(2000)
  const end = await all(page)
  console.log('RESTORED MISMATCH', JSON.stringify(names.filter(n => end[n] !== before[n])))
})
