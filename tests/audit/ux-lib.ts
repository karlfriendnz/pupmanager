// UX-audit only. Own login + own storage-state file so this can run alongside
// the other audit agents' sessions. Targets the running dev server on 7777.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

export const BASE = 'http://localhost:7777'
export const SHOTS = '/Users/karl/Desktop/Temp'

export const ACCOUNTS = {
  trainer: { email: 'audit.ux@pupaudit.test', password: 'AuditUx2026!', state: '.ux-trainer-state.json' },
  empty: { email: 'audit.ux.empty@pupaudit.test', password: 'AuditUx2026!', state: '.ux-empty-state.json' },
  client: { email: 'audit.ux.client@pupaudit.test', password: 'AuditUx2026!', state: '.ux-client-state.json' },
}
export type AccountKey = keyof typeof ACCOUNTS

export async function open(which: AccountKey, opts: { width?: number; height?: number } = {}) {
  const acct = ACCOUNTS[which]
  const STATE = path.join(process.cwd(), 'tests/audit', acct.state)
  const browser = await chromium.launch()
  const viewport = { width: opts.width ?? 1440, height: opts.height ?? 900 }
  const landing = which === 'client' ? '/home' : '/dashboard'
  // tsx compiles with esbuild `keepNames`, which wraps every inner function in
  // `__name(...)`. That helper doesn't exist in the page, so any page.evaluate
  // with a named inner function throws ReferenceError. Define it in-page.
  const shim = () => { (globalThis as unknown as { __name: unknown }).__name = (f: unknown) => f }
  if (fs.existsSync(STATE)) {
    const ctx = await browser.newContext({ storageState: STATE, viewport, deviceScaleFactor: 1 })
    await ctx.addInitScript(shim)
    const page = await ctx.newPage()
    // The shared dev server compiles on demand and is busy — give the probe
    // navigation room rather than throwing away a perfectly good session.
    const ok = await page.goto(BASE + landing, { waitUntil: 'domcontentloaded', timeout: 90000 })
      .then(() => true).catch(() => false)
    if (ok && !page.url().includes('/login')) return { browser, ctx, page }
    await ctx.close()
  }
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.addInitScript(shim)
  const page = await ctx.newPage()
  // The shared dev server is under load from other agents, so a sign-in can
  // take well over the usual timeout. Retry, and only trust the session once a
  // protected page actually renders — otherwise a half-finished login gets
  // written to the state file and every screen after it is the login page.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"], input[name="email"]', acct.email)
    await page.fill('input[type="password"], input[name="password"]', acct.password)
    await Promise.all([
      page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 90000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(2500)
    await page.goto(BASE + landing, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForTimeout(1200)
    if (!page.url().includes('/login')) {
      await ctx.storageState({ path: STATE })
      return { browser, ctx, page }
    }
  }
  throw new Error(`could not sign in as ${acct.email}`)
}

export async function close(h: { browser: Browser }) { await h.browser.close() }

/** React handlers here often ignore Playwright's synthetic clicks. */
export async function domClick(page: Page, text: string, tags = 'button,a,[role="button"],[role="tab"],summary,label') {
  const ok = await page.evaluate(({ text, tags }) => {
    const els = Array.from(document.querySelectorAll(tags)) as HTMLElement[]
    const vis = els.filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
    const el = vis.find(e => (e.innerText || '').trim() === text)
      ?? vis.find(e => (e.innerText || '').trim().includes(text))
      ?? vis.find(e => (e.getAttribute('aria-label') || '') === text)
    if (!el) return false
    el.click()
    return true
  }, { text, tags })
  if (ok) await page.waitForTimeout(900)
  return ok
}

export type Probe = ReturnType<typeof probeSource>
function probeSource() { return null as unknown as Record<string, unknown> }

/** Everything mechanical we can measure about a rendered screen. */
export async function probe(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const desc = (el: Element) => {
      const e = el as HTMLElement
      const id = e.id ? '#' + e.id : ''
      const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 6).join('.')
      const txt = (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 48)
      return `${e.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}${txt ? ` «${txt}»` : ''}`
    }
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[]
    const visible = all.filter(e => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
    })

    // ── horizontal overflow ────────────────────────────────────────────────
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    const bodyOverflow = document.body.scrollWidth - document.body.clientWidth
    const offenders = visible
      .filter(e => {
        const r = e.getBoundingClientRect()
        return r.right > vw + 1 || r.left < -1
      })
      // only report the outermost offender in each chain
      .filter(e => {
        const p = e.parentElement
        if (!p) return true
        const pr = p.getBoundingClientRect()
        return !(pr.right > vw + 1 || pr.left < -1)
      })
      .slice(0, 12)
      .map(e => ({ el: desc(e), right: Math.round(e.getBoundingClientRect().right), left: Math.round(e.getBoundingClientRect().left) }))

    // ── scrollable regions (second-scrollbar risk) ─────────────────────────
    const scrollers = visible.filter(e => {
      const cs = getComputedStyle(e)
      const oy = cs.overflowY
      return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 4
    }).map(e => ({
      el: desc(e),
      noScrollbar: (typeof e.className === 'string' ? e.className : '').includes('no-scrollbar'),
      h: Math.round(e.getBoundingClientRect().height),
    }))
    const bodyLocked = getComputedStyle(document.body).overflow === 'hidden'
      || getComputedStyle(document.documentElement).overflow === 'hidden'
    const pageScrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 4

    // ── house-style tells ──────────────────────────────────────────────────
    const gradients = visible.filter(e => {
      const bg = getComputedStyle(e).backgroundImage
      return bg.includes('gradient')
    }).slice(0, 10).map(e => ({ el: desc(e), bg: getComputedStyle(e).backgroundImage.slice(0, 90) }))

    // a "tinted icon tile": a small rounded element with a non-white/non-transparent
    // background whose only content is an svg
    const iconTiles = visible.filter(e => {
      const r = e.getBoundingClientRect()
      if (r.width > 72 || r.height > 72 || r.width < 16) return false
      const cs = getComputedStyle(e)
      const bg = cs.backgroundColor
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false
      if (/^rgba?\(255, 255, 255/.test(bg)) return false
      if (parseFloat(cs.borderRadius) < 4) return false
      const svgs = e.querySelectorAll('svg')
      return svgs.length === 1 && (e.innerText || '').trim() === ''
    }).slice(0, 14).map(e => ({ el: desc(e), bg: getComputedStyle(e).backgroundColor, radius: getComputedStyle(e).borderRadius }))

    // floating cards: siblings that each carry their own box-shadow
    const shadowed = visible.filter(e => {
      const cs = getComputedStyle(e)
      return cs.boxShadow !== 'none' && e.getBoundingClientRect().height > 60
    })
    const shadowSiblingGroups: { parent: string; count: number; sample: string }[] = []
    const byParent = new Map<Element, HTMLElement[]>()
    for (const e of shadowed) {
      const p = e.parentElement
      if (!p) continue
      byParent.set(p, [...(byParent.get(p) ?? []), e])
    }
    for (const [p, kids] of byParent) if (kids.length >= 2) {
      shadowSiblingGroups.push({ parent: desc(p), count: kids.length, sample: desc(kids[0]) })
    }

    // stroke widths on line icons
    const strokes = new Map<string, number>()
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const sw = svg.getAttribute('stroke-width') ?? getComputedStyle(svg).strokeWidth
      if (!sw || sw === 'none') continue
      strokes.set(String(sw), (strokes.get(String(sw)) ?? 0) + 1)
    }

    // ── touch targets ──────────────────────────────────────────────────────
    const tappable = visible.filter(e => {
      const t = e.tagName.toLowerCase()
      if (!['button', 'a', 'summary'].includes(t) && e.getAttribute('role') !== 'button' && e.getAttribute('role') !== 'tab') return false
      if ((e as HTMLElement).offsetParent === null) return false
      return true
    })
    const smallTargets = tappable.filter(e => {
      const r = e.getBoundingClientRect()
      return (r.width < 40 || r.height < 40) && r.width > 0
    }).slice(0, 20).map(e => {
      const r = e.getBoundingClientRect()
      return { el: desc(e), w: Math.round(r.width), h: Math.round(r.height) }
    })

    // ── a11y ───────────────────────────────────────────────────────────────
    const accName = (e: HTMLElement) =>
      (e.getAttribute('aria-label') || '').trim()
      || (e.innerText || '').trim()
      || (e.getAttribute('title') || '').trim()
      || (e.querySelector('img')?.getAttribute('alt') || '').trim()
    const namelessControls = tappable.filter(e => !accName(e)).slice(0, 15).map(desc)
    const dupNames = (() => {
      const m = new Map<string, number>()
      for (const e of tappable) {
        const n = accName(e)
        if (!n) continue
        m.set(n, (m.get(n) ?? 0) + 1)
      }
      return Array.from(m).filter(([, c]) => c > 1).map(([n, c]) => ({ name: n.slice(0, 40), count: c }))
    })()
    const fields = Array.from(document.querySelectorAll('input, select, textarea')) as HTMLElement[]
    const unlabelled = fields.filter(f => {
      const el = f as HTMLInputElement
      if (['hidden', 'submit', 'button'].includes(el.type)) return false
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false
      if (el.closest('label')) return false
      return true
    }).slice(0, 15).map(f => ({ el: desc(f), type: (f as HTMLInputElement).type, ph: (f as HTMLInputElement).placeholder }))
    const imgsNoAlt = Array.from(document.querySelectorAll('img')).filter(i => !i.hasAttribute('alt')).slice(0, 10).map(desc)
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({
      lvl: Number(h.tagName[1]), text: (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
    }))
    const h1s = headings.filter(h => h.lvl === 1).length
    const headingJumps: string[] = []
    let prev = 0
    for (const h of headings) {
      if (prev && h.lvl > prev + 1) headingJumps.push(`h${prev} → h${h.lvl} at “${h.text}”`)
      prev = h.lvl
    }

    // ── text ───────────────────────────────────────────────────────────────
    const tinyText = visible.filter(e => {
      if (e.children.length) return false
      const txt = (e.innerText || '').trim()
      if (txt.length < 4) return false
      return parseFloat(getComputedStyle(e).fontSize) < 12
    }).slice(0, 10).map(e => ({ el: desc(e), size: getComputedStyle(e).fontSize }))

    return {
      url: location.pathname + location.search,
      vw,
      docOverflow, bodyOverflow, offenders,
      scrollers, bodyLocked, pageScrolls,
      gradients, iconTiles, shadowSiblingGroups,
      strokes: Array.from(strokes).sort((a, b) => b[1] - a[1]),
      smallTargets, namelessControls, dupNames, unlabelled, imgsNoAlt,
      h1s, headingJumps, headings: headings.slice(0, 25),
      tinyText,
      title: (document.querySelector('main h1') as HTMLElement)?.innerText?.trim().slice(0, 60)
        ?? (document.querySelector('h1') as HTMLElement)?.innerText?.trim().slice(0, 60) ?? '',
      bodyText: (document.querySelector('main') ?? document.body).innerText.replace(/\s+/g, ' ').trim().slice(0, 400),
    }
  })
}

export async function shot(page: Page, name: string) {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true })
  const f = path.join(SHOTS, `ux-${name}.png`)
  await page.screenshot({ path: f, fullPage: false })
  return f
}
