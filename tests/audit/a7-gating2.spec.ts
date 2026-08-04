import { test } from '@playwright/test'

async function setFeature(page: any, id: string, active: boolean) {
  return page.evaluate(async ([i, a]: any) => {
    const r = await fetch('/api/addons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: i, active: a }) })
    return r.status
  }, [id, active])
}
const settingsTabs = (page: any) => page.evaluate(() =>
  Array.from(document.querySelectorAll('nav button')).map(b => (b as HTMLElement).innerText.trim()).filter(Boolean))

const ROUTES: Record<string, string> = {
  todos: '/todos', notes: '/sessions/draft-notes', xero: '/settings?tab=xero',
  googlecalendar: '/settings?tab=calendar', puppyschool: '/doggy-daycare',
  leadmagnets: '/lead-magnets', ai: '/ai-tools',
}

test('tab + route gating for the switches with no nav entry', async ({ page }) => {
  test.setTimeout(900000)
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 })
  for (const [f, route] of Object.entries(ROUTES)) {
    const out: any = { feature: f, route }
    await setFeature(page, f, true)
    await page.goto('/settings?tab=profile', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(2000)
    out.tabsOn = await settingsTabs(page)
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(2500)
    out.urlOn = page.url().replace('http://localhost:7777', '')
    out.textOn = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160)

    await setFeature(page, f, false)
    await page.goto('/settings?tab=profile', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(2000)
    out.tabsOff = await settingsTabs(page)
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(2500)
    out.urlOff = page.url().replace('http://localhost:7777', '')
    out.textOff = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160)
    out.tabDiff = out.tabsOn.filter((t: string) => !out.tabsOff.includes(t))
    console.log('GATE', JSON.stringify({ feature: f, tabDiff: out.tabDiff, urlOn: out.urlOn, urlOff: out.urlOff, sameText: out.textOn === out.textOff }, null, 0))
    console.log('   ON :', out.textOn)
    console.log('   OFF:', out.textOff)
    await setFeature(page, f, true)
  }
})
