// UX-audit only: visit every trainer/client screen at 390, 760 and 1440 and
// dump the mechanical layout/a11y measurements to tests/audit/out/ux-<acct>.json.
// Run: npx tsx tests/audit/ux-sweep.ts [trainer|empty|client]
import { open, close, probe, BASE, type AccountKey } from './ux-lib'
import fs from 'fs'

const TRAINER_ROUTES = [
  '/dashboard', '/schedule', '/schedule/route', '/clients', '/clients/import', '/clients/waitlist',
  '/enquiries', '/messages', '/sessions/draft-notes', '/sessions/needs-notes',
  '/packages', '/packages/new', '/classes', '/casual-classes', '/events', '/doggy-daycare',
  '/memberships', '/offerings/tags', '/library', '/products', '/products/categories',
  '/achievements', '/awards', '/marketing', '/marketing/new', '/instagram', '/lead-magnets',
  '/finances', '/finances/stripe', '/timesheets', '/reports', '/forms', '/forms/session',
  '/settings', '/help', '/notifications', '/booking-page', '/website', '/availability',
  '/templates', '/ai-tools', '/progress', '/add-ons', '/billing', '/email-templates',
]

const CLIENT_ROUTES = [
  '/home', '/my-sessions', '/my-homework', '/my-dogs', '/my-achievements', '/my-messages',
  '/my-invoices', '/my-shop', '/my-memberships', '/my-availability', '/my-notifications',
  '/my-profile', '/my-help', '/basket', '/switch-trainer',
]

const WIDTHS = [
  { w: 390, h: 844, tag: '390' },
  { w: 760, h: 560, tag: '760' },
  
]

/** The shared dev server is restarted by other agents mid-run — wait it out. */
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/login')
      if (r.ok) return true
    } catch { /* down */ }
    await new Promise(r => setTimeout(r, 3000))
  }
  return false
}

async function main() {
  const which = (process.argv[2] ?? 'trainer') as AccountKey
  const routes = which === 'client' ? CLIENT_ROUTES : TRAINER_ROUTES
  const file = `tests/audit/out/ux-${which}.json`
  // Merge, so a rerun of one width keeps the widths already measured.
  const out: Record<string, Record<string, unknown>> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {}

  for (const { w, h, tag } of WIDTHS) {
    await waitForServer()
    const s = await open(which, { width: w, height: h })
    for (const r of routes) {
      let done = false
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const resp = await s.page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 45000 })
          await s.page.waitForTimeout(1700)
          const p = await probe(s.page)
          out[r] = out[r] ?? {}
          out[r][tag] = { status: resp?.status() ?? null, landed: s.page.url().replace(BASE, ''), ...p }
          const flag = p.docOverflow > 0 ? ` OVERFLOW+${p.docOverflow}` : ''
          console.log(`${tag}  ${r} -> ${(out[r][tag] as { landed: string }).landed}${flag}`)
          done = true
        } catch (e) {
          if (String(e).includes('ERR_CONNECTION_REFUSED')) { await waitForServer(); continue }
          out[r] = out[r] ?? {}
          out[r][tag] = { error: String(e).slice(0, 160) }
          console.log(`${tag}  ${r} ERROR ${String(e).slice(0, 100)}`)
          done = true
        }
      }
    }
    await close(s)
  }
  fs.mkdirSync('tests/audit/out', { recursive: true })
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log('\nwrote ' + file)
}
main()
