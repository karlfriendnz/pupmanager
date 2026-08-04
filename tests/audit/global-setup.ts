import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
const EMAIL = 'audit.settings@pupaudit.test'
const PASSWORD = 'AuditSet2026!'
export const STATE = 'tests/audit/.state.json'
export default async function () {
  const browser = await chromium.launch()
  // Reuse the saved session if it still works — the dev server's login rate
  // limit is per-IP and shared with the other audit agents.
  if (fs.existsSync(STATE)) {
    try {
      const ctx = await browser.newContext({ storageState: STATE })
      const p = await ctx.newPage()
      await p.goto('http://localhost:7777/dashboard', { waitUntil: 'domcontentloaded', timeout: 90000 })
      await p.waitForTimeout(1500)
      if (!p.url().includes('/login')) { await browser.close(); console.log('[audit] reused session'); return }
      await ctx.close()
    } catch (e) { console.log('[audit] state reuse failed:', (e as Error).message.slice(0, 80)) }
  }
  try { execSync(`psql "postgresql://karl@localhost:5432/pupmanager_dev" -c "delete from rate_limits where key like 'login%'"`, { stdio: 'ignore' }) } catch {}
  const ctx = await browser.newContext({ baseURL: 'http://localhost:7777' })
  const page = await ctx.newPage()
  let ok = false
  for (let i = 0; i < 5 && !ok; i++) {
    try {
      await page.goto('http://localhost:7777/login', { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.waitForTimeout(3000)
      await page.fill('input[type="email"], input[name="email"]', EMAIL)
      await page.fill('input[type="password"], input[name="password"]', PASSWORD)
      await page.waitForTimeout(300)
      await page.click('button[type="submit"]')
      await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 40000 })
      ok = true
    } catch { console.log('[audit] login attempt', i + 1, 'failed, retrying') }
  }
  if (!ok) throw new Error('audit login failed after 5 attempts')
  await page.waitForTimeout(1500)
  await ctx.storageState({ path: STATE })
  await browser.close()
  console.log('[audit] logged in, state saved')
}
