import { test } from '@playwright/test'
import { tab } from './helpers'

const navSnap = (page: any) => page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('nav a[href], aside a[href]')) as HTMLAnchorElement[]
  return Array.from(new Set(links.map(a => a.getAttribute('href')! + ' :: ' + a.innerText.replace(/\s+/g, ' ').trim()))).filter(Boolean)
})

async function setFeature(page: any, id: string, active: boolean) {
  return page.evaluate(async ([i, a]: any) => {
    const r = await fetch('/api/addons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: i, active: a }) })
    return r.status + ' ' + (await r.text()).slice(0, 200)
  }, [id, active])
}

const FEATURES = ['messaging', 'library', 'timesheets', 'todos', 'events', 'memberships', 'classes', 'dropins', 'onetoone', 'notes', 'instagram', 'xero', 'googlecalendar', 'puppyschool', 'achievements', 'shop', 'marketing', 'routeplanner', 'leadmagnets', 'ai']

test('addon gating: nav + settings tabs appear/disappear', async ({ page }) => {
  test.setTimeout(900000)
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(3000)
  const baseNav = await navSnap(page)
  console.log('BASE NAV', JSON.stringify(baseNav, null, 1))

  for (const f of FEATURES) {
    const onRes = await setFeature(page, f, true)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(2200)
    const navOn = await navSnap(page)
    const offRes = await setFeature(page, f, false)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForTimeout(2200)
    const navOff = await navSnap(page)
    const gained = navOn.filter((x: string) => !navOff.includes(x))
    const lost = navOff.filter((x: string) => !navOn.includes(x))
    console.log('FEATURE', f, '| POST on:', onRes.slice(0, 40), '| POST off:', offRes.slice(0, 40))
    console.log('   navDiff on-only:', JSON.stringify(gained), ' off-only:', JSON.stringify(lost))
    // restore ON so later checks work
    await setFeature(page, f, true)
  }
})
