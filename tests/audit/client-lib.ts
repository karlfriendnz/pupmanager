import { chromium, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs'

export const BASE = 'http://localhost:7777'
export const FIX = JSON.parse(fs.readFileSync('tests/audit/.client-fixture.json', 'utf8'))

export async function loginAs(email: string, password: string, opts: { width?: number; height?: number; activeClientId?: string } = {}) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 } })
  if (opts.activeClientId) {
    await ctx.addCookies([{ name: 'pm-active-trainer', value: opts.activeClientId, domain: 'localhost', path: '/' }])
  }
  const page = await ctx.newPage()
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.fill('input[type="email"], input[name="email"]', email)
    await page.fill('input[type="password"], input[name="password"]', password)
    await Promise.all([
      page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 45000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(2500)
    const probe = await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null)
    void probe
    if (!page.url().includes('/login')) return { browser, ctx, page }
    console.error(`login attempt ${attempt + 1} failed for ${email}`)
    await page.waitForTimeout(3000)
  }
  throw new Error('could not sign in as ' + email)
}

export async function grab(page: Page, path: string) {
  const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch(() => null)
  await page.waitForTimeout(700)
  const html = await page.content().catch(() => '')
  return { status: res?.status() ?? 0, url: page.url(), html, text: await page.evaluate(() => document.body?.innerText ?? '').catch(() => '') }
}

/** Fetch a JSON API through the logged-in browser context (carries cookies).
 *  Timed out per call — the shared dev server stalls under audit load and a
 *  hung fetch would freeze the whole sweep. */
export async function api(page: Page, path: string, init?: { method?: string; body?: unknown }) {
  try {
    return await page.evaluate(async ({ p, i }) => {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 120000)
      try {
        const r = await fetch(p, {
          method: i?.method ?? 'GET',
          headers: i?.body ? { 'Content-Type': 'application/json' } : {},
          body: i?.body ? JSON.stringify(i.body) : undefined,
          signal: ac.signal,
        })
        return { status: r.status, body: (await r.text()).slice(0, 4000) }
      } catch (e) {
        return { status: -1, body: 'FETCH FAILED ' + String(e).slice(0, 120) }
      } finally { clearTimeout(t) }
    }, { p: path, i: init ?? null })
  } catch (e) {
    return { status: -2, body: 'EVAL FAILED ' + String(e).slice(0, 120) }
  }
}

export async function close(h: { browser: Browser }) { await h.browser.close() }

export const LEAKS = {
  PRIVATE_ANSWER: 'PRIVATE-RISK-RATING-DO-NOT-LEAK',
  DRAFT_ANSWER: 'DRAFT-UNSENT-NOTES-DO-NOT-LEAK',
  OTHER_CLIENT_ANSWER: 'OTHER-CLIENT-NOTES-DO-NOT-LEAK',
  OTHER_CLIENT_HOMEWORK: 'OTHER-CLIENT-HOMEWORK-DO-NOT-LEAK',
  TRAINER_B_ANSWER: 'TRAINER-B-NOTES-DO-NOT-LEAK',
  TRAINER_B_HOMEWORK: 'TRAINER-B-HOMEWORK-DO-NOT-LEAK',
  AFTER_HIDDEN: 'AUDIT-AFTER-HIDDEN',
  HIDDEN_PRODUCT: 'Audit Hidden Clicker',
  HIDDEN_OFFERING: 'Audit Term 4 (not yet visible)',
  PRIVATE_INTAKE_LABEL: 'Internal risk rating (team only)',
  OTHER_INVOICE: 'OTHER-CLIENT-INVOICE-DO-NOT-LEAK',
}
