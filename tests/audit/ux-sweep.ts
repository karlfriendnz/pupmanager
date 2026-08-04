// UX-audit only. Visits a SLICE of the app at one width and appends the
// mechanical layout/a11y measurements to tests/audit/out/ux-<acct>.json.
//
// Deliberately slice-at-a-time: the dev server is shared with several other
// agents, and a long-lived Playwright session against it dies. Each run opens
// one context, does a handful of screens, writes after EVERY screen, and quits.
// Re-run with the next offset; results merge.
//
// Run: npx tsx tests/audit/ux-sweep.ts <trainer|empty|client> <390|760|1440> [offset] [count]
import { open, close, probe, BASE, type AccountKey } from './ux-lib'
import fs from 'fs'

export const TRAINER_ROUTES = [
  '/dashboard', '/schedule', '/clients', '/enquiries', '/messages',
  '/sessions/draft-notes', '/sessions/needs-notes', '/packages', '/classes',
  '/casual-classes', '/events', '/doggy-daycare', '/memberships', '/offerings/tags',
  '/library', '/products', '/products/categories', '/achievements', '/awards',
  '/marketing', '/instagram', '/lead-magnets', '/finances', '/timesheets',
  '/reports', '/settings', '/notifications', '/website', '/templates',
  '/ai-tools', '/progress', '/add-ons', '/email-templates', '/clients/waitlist',
  '/clients/import', '/marketing/new', '/schedule/route',
]

export const CLIENT_ROUTES = [
  '/home', '/my-sessions', '/my-homework', '/my-dogs', '/my-achievements',
  '/my-messages', '/my-invoices', '/my-shop', '/my-memberships',
  '/my-availability', '/my-notifications', '/my-profile', '/my-help', '/basket',
]

const SIZES: Record<string, { w: number; h: number }> = {
  '390': { w: 390, h: 844 },
  '760': { w: 760, h: 560 },
  '1440': { w: 1440, h: 900 },
}

async function main() {
  const which = (process.argv[2] ?? 'trainer') as AccountKey
  const tag = process.argv[3] ?? '390'
  const offset = Number(process.argv[4] ?? 0)
  const count = Number(process.argv[5] ?? 8)
  const size = SIZES[tag]
  if (!size) throw new Error('width must be 390, 760 or 1440')

  const all = which === 'client' ? CLIENT_ROUTES : TRAINER_ROUTES
  const routes = all.slice(offset, offset + count)
  if (!routes.length) { console.log('nothing left at offset ' + offset); return }

  const file = `tests/audit/out/ux-${which}.json`
  fs.mkdirSync('tests/audit/out', { recursive: true })
  const out: Record<string, Record<string, unknown>> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const save = () => fs.writeFileSync(file, JSON.stringify(out, null, 2))

  const s = await open(which, { width: size.w, height: size.h })
  for (const r of routes) {
    try {
      const resp = await s.page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await s.page.waitForTimeout(1500)
      const p = await probe(s.page)
      out[r] = out[r] ?? {}
      out[r][tag] = { status: resp?.status() ?? null, landed: s.page.url().replace(BASE, ''), ...p }
      console.log(`${tag} ${r} -> ${s.page.url().replace(BASE, '')}${p.docOverflow > 0 ? ' OVERFLOW+' + p.docOverflow : ''}`)
    } catch (e) {
      out[r] = out[r] ?? {}
      out[r][tag] = { error: String(e).slice(0, 140) }
      console.log(`${tag} ${r} ERROR ${String(e).slice(0, 80)}`)
    }
    save() // after EVERY screen — a dead session must not cost the whole slice
  }
  await close(s)
  console.log(`done ${offset}..${offset + routes.length} of ${all.length}`)
}
main()
