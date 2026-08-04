import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

export const BASE = 'http://localhost:7777'
export const EMAIL = 'audit.settings@pupaudit.test'
export const PASSWORD = 'AuditSet2026!'
const STATE = path.join(process.cwd(), 'tests/audit/.state.json')

export async function open(opts: { width?: number; height?: number; fresh?: boolean } = {}) {
  const browser = await chromium.launch()
  let ctx: BrowserContext
  const viewport = { width: opts.width ?? 1440, height: opts.height ?? 900 }
  if (fs.existsSync(STATE) && !opts.fresh) {
    ctx = await browser.newContext({ storageState: STATE, viewport })
    const page = await ctx.newPage()
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' })
    if (!page.url().includes('/login')) return { browser, ctx, page }
    await page.close()
    await ctx.close()
  }
  ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await login(page)
  await ctx.storageState({ path: STATE })
  return { browser, ctx, page }
}

export async function login(page: Page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1500)
}

export async function hardClick(page: Page, selector: string) {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return false
    el.click()
    return true
  }, selector)
  if (!ok) throw new Error('no element for ' + selector)
}

export async function close(h: { browser: Browser }) { await h.browser.close() }
