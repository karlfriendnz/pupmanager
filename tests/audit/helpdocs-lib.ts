// Audit-only helpers for the help-doc verification pass. Own login + own state
// file so this can run alongside another agent's tests/audit/lib.ts session.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

export const BASE = 'http://localhost:7777'
export const EMAIL = 'audit.helpdocs@pupaudit.test'
export const PASSWORD = 'HelpDocs2026!'
const STATE = path.join(process.cwd(), 'tests/audit/.helpdocs-state.json')

/**
 * The dev server compiles a route the first time it is asked for, and several
 * agents share this machine — 30s is nowhere near enough. Everything here uses
 * a long default and waits for the server to answer at all before starting.
 */
const NAV_TIMEOUT = 120_000

export async function waitForServer(maxMs = 180_000) {
  const until = Date.now() + maxMs
  while (Date.now() < until) {
    try {
      const r = await fetch(BASE + '/login')
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 2000))
  }
  return false
}

export async function open(opts: { width?: number; height?: number; fresh?: boolean } = {}) {
  await waitForServer()
  const browser = await chromium.launch()
  let ctx: BrowserContext
  const viewport = { width: opts.width ?? 1440, height: opts.height ?? 900 }
  if (fs.existsSync(STATE) && !opts.fresh) {
    ctx = await browser.newContext({ storageState: STATE, viewport })
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT)
    const page = await ctx.newPage()
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    if (!page.url().includes('/login')) return { browser, ctx, page }
    await page.close()
    await ctx.close()
  }
  ctx = await browser.newContext({ viewport })
  ctx.setDefaultNavigationTimeout(NAV_TIMEOUT)
  const page = await ctx.newPage()
  await login(page)
  await ctx.storageState({ path: STATE })
  return { browser, ctx, page }
}

export async function login(page: Page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1500)
}

/** React handlers here often ignore synthetic clicks — go via the DOM. */
export async function hardClick(page: Page, selector: string) {
  const ok = await page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  )
  if (!ok) throw new Error('no element for ' + selector)
  await page.waitForTimeout(600)
}

/** Click the first element whose trimmed text equals/contains `text`. */
export async function clickByText(
  page: Page,
  text: string,
  tags = 'button,a,[role="button"],[role="tab"],summary,label',
): Promise<boolean> {
  const ok = await page.evaluate(`(() => {
    const text = ${JSON.stringify(text)}, tags = ${JSON.stringify(tags)};
    const els = Array.from(document.querySelectorAll(tags));
    const txt = e => (e.innerText || '').replace(/\\s+/g,' ').trim();
    const el = els.find(e => txt(e) === text) || els.find(e => txt(e).includes(text));
    if (!el) return false;
    el.click();
    return true;
  })()`) as boolean
  if (ok) await page.waitForTimeout(900)
  return ok
}

/** Does this screen name `text` anywhere clickable? (no click) */
export async function hasControl(page: Page, text: string): Promise<boolean> {
  return page.evaluate(`(() => {
    const text = ${JSON.stringify(text)}.toLowerCase();
    const els = Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"],label,summary,h1,h2,h3'));
    return els.some(e => (e.innerText || '').replace(/\\s+/g,' ').trim().toLowerCase().includes(text));
  })()`) as Promise<boolean>
}

// NOTE: every browser-side snippet in this file is a STRING, not an arrow
// function. tsx/esbuild rewrites inline functions with a `__name` helper that
// doesn't exist in the page, so `page.evaluate(fn)` throws ReferenceError.
const VOCAB_JS = `(() => {
  const t = el => (el.innerText || '').replace(/\\s+/g, ' ').trim();
  const uniq = a => Array.from(new Set(a.filter(s => s && s.length < 90)));
  const main = document.querySelector('main') || document.body;
  const q = sel => Array.from(main.querySelectorAll(sel));
  return {
    url: location.pathname + location.search,
    title: document.title,
    h1: uniq(q('h1').map(t)),
    headings: uniq(q('h2,h3,h4').map(t)),
    buttons: uniq(q('button,[role="button"],input[type=submit]').map(t)),
    tabs: uniq(q('[role="tab"],[role="tablist"] a,[role="tablist"] button').map(t)),
    links: uniq(q('a').map(t)),
    labels: uniq(q('label').map(t)),
    placeholders: uniq(Array.from(document.querySelectorAll('input,textarea')).map(e => e.placeholder)),
    selects: Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name, options: Array.from(s.options).map(o => o.text.trim()),
    })),
    sidebar: uniq(Array.from(document.querySelectorAll('aside a, aside button')).map(t)),
    topbar: uniq(Array.from(document.querySelectorAll('header a, header button')).map(
      el => t(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '')),
    bodyText: (main.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 8000),
  };
})()`

export type Vocab = {
  url: string; title: string; h1: string[]; headings: string[]; buttons: string[]
  tabs: string[]; links: string[]; labels: string[]; placeholders: string[]
  selects: { name: string; options: string[] }[]
  sidebar: string[]; topbar: string[]; bodyText: string
}

/** Everything a help article could plausibly name on this screen. */
export async function vocab(page: Page): Promise<Vocab> {
  return page.evaluate(VOCAB_JS) as Promise<Vocab>
}

export async function close(h: { browser: Browser }) { await h.browser.close() }
