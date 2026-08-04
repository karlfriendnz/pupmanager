// UX-audit only: open the overlays a trainer actually meets and measure the
// two-scrollbar rule on each — is body scroll locked, and does the sheet's own
// scrolling region show a rail? Also screenshots the worst offenders.
// Run: npx tsx tests/audit/ux-overlays.ts
import { open, close, domClick, shot, BASE } from './ux-lib'
import type { Page } from '@playwright/test'
import fs from 'fs'

async function overlayState(page: Page) {
  return page.evaluate(() => {
    const bodyLocked = getComputedStyle(document.body).overflow === 'hidden'
      || getComputedStyle(document.documentElement).overflow === 'hidden'
    const pageWouldScroll = document.documentElement.scrollHeight > document.documentElement.clientHeight + 4
    // Anything that looks like an overlay root.
    const roots = Array.from(document.querySelectorAll('.pm-overlay, [role="dialog"], [aria-modal="true"]'))
      .concat(Array.from(document.querySelectorAll('div')).filter(d => {
        const cs = getComputedStyle(d)
        return cs.position === 'fixed' && d.getBoundingClientRect().height > window.innerHeight * 0.6
          && d.getBoundingClientRect().width > window.innerWidth * 0.6
      }))
    const seen = new Set<Element>()
    const overlays = roots.filter(r => { if (seen.has(r)) return false; seen.add(r); return true }).map(r => {
      const el = r as HTMLElement
      const rails = (Array.from(el.querySelectorAll('*')) as HTMLElement[]).filter(e => {
        const cs = getComputedStyle(e)
        if (!['auto', 'scroll'].includes(cs.overflowY)) return false
        if (e.scrollHeight <= e.clientHeight + 4) return false
        return e.offsetWidth - e.clientWidth > 0
      }).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(/\s+/).slice(0, 4).join('.'))
      return {
        cls: String(el.className).split(/\s+/).slice(0, 6).join('.'),
        role: el.getAttribute('role'), ariaModal: el.getAttribute('aria-modal'),
        pmOverlay: String(el.className).includes('pm-overlay'),
        visibleRails: rails,
      }
    })
    return { bodyLocked, pageWouldScroll, twoScrollbars: !bodyLocked && pageWouldScroll, overlays }
  })
}

type Case = { name: string; route: string; opener: (p: Page) => Promise<boolean> }

const CASES: Case[] = [
  // The first screen a new trainer meets — the welcome modal pops on load.
  { name: 'dashboard-welcome-modal', route: '/dashboard', opener: async () => true },
  { name: 'phone-create-sheet', route: '/clients', opener: async p => p.evaluate(() => {
      const b = document.querySelector('button[aria-label="Create"]') as HTMLElement | null
      if (!b) return false; b.click(); return true }) },
  { name: 'clients-quick-add', route: '/clients', opener: p => domClick(p, 'Quick add') },
  { name: 'schedule-settings', route: '/schedule', opener: p => domClick(p, 'View options') },
  { name: 'reports-view-data', route: '/reports', opener: p => domClick(p, 'View data') },
  { name: 'library-new-category', route: '/library', opener: p => domClick(p, 'New category') },
  { name: 'products-new', route: '/products', opener: p => domClick(p, 'New product') },
  { name: 'settings-tabs', route: '/settings', opener: async () => true },
]

async function main() {
  // Width matters here: globals.css's scrollbar-hiding rule keys off VIEWPORT
  // width (max-width: 767px), so a narrow desktop window at 760×560 is exactly
  // where a second rail reappears. Run this at 390 AND 760.
  const w = Number(process.argv[2] ?? 390)
  const h = Number(process.argv[3] ?? (w === 390 ? 844 : 560))
  const only = process.argv[4]
  const file = `tests/audit/out/ux-overlays-${w}.json`
  const out: Record<string, unknown> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  fs.mkdirSync('tests/audit/out', { recursive: true })
  const s = await open('trainer', { width: w, height: h })
  for (const c of CASES.filter(c => !only || c.name.includes(only))) {
    try {
      await s.page.goto(BASE + c.route, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await s.page.waitForTimeout(1800)
      const opened = await c.opener(s.page)
      await s.page.waitForTimeout(1200)
      const st = await overlayState(s.page)
      out[c.name] = { opened, ...st }
      console.log(c.name, 'opened=' + opened, 'twoScrollbars=' + st.twoScrollbars,
        'overlays=' + st.overlays.length, JSON.stringify(st.overlays.slice(0, 2)))
      await shot(s.page, w + '-' + c.name)
    } catch (e) {
      out[c.name] = { error: String(e).slice(0, 140) }
      console.log(c.name, 'ERROR', String(e).slice(0, 90))
    }
    fs.writeFileSync(file, JSON.stringify(out, null, 2))
  }
  await close(s)
  console.log('\nwrote ' + file)
}
main()
