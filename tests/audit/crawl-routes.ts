// Audit-only: visit every trainer screen and dump the controls it actually
// renders, so help-article steps can be checked against real UI text.
// Run: npx tsx tests/audit/crawl-routes.ts
import { open, close, vocab, BASE } from './helpdocs-lib'
import fs from 'fs'

const ROUTES = [
  '/dashboard',
  '/messages',
  '/schedule',
  '/schedule/route',
  '/clients',
  '/clients/invite',
  '/clients/waitlist',
  '/enquiries',
  '/sessions/draft-notes',
  '/sessions/needs-notes',
  '/offerings',
  '/offerings/new',
  '/settings?tab=tags',
  '/packages',
  '/classes',
  '/casual-classes',
  '/events',
  '/memberships',
  '/doggy-daycare',
  '/library',
  '/products',
  '/products/new',
  '/products/categories',
  '/achievements',
  '/achievements/new',
  '/awards',
  '/marketing',
  '/marketing/new',
  '/lead-magnets',
  '/instagram',
  '/email-templates',
  '/finances',
  '/finances/stripe',
  '/timesheets',
  '/reports',
  '/progress',
  '/website',
  '/forms/intake',
  '/forms/new',
  '/forms/client/new',
  '/forms/session/new',
  '/forms/embed/new',
  '/templates',
  '/templates/new',
  '/ai-tools',
  '/add-ons',
  '/settings',
  '/help',
  '/notifications',
]

// Settings is one page of tabs — each tab is its own "screen" for help purposes.
const SETTINGS_TABS = [
  'details', 'design', 'forms', 'configure', 'addons', 'payments',
  'notifications', 'team', 'integrations', 'account', 'billing', 'locations',
  'custom-fields', 'availability', 'plan',
]
for (const t of SETTINGS_TABS) ROUTES.push(`/settings?tab=${t}`)

const OUT = 'tests/audit/out/routes.json'

// The dev server restarts on its own while several agents edit the tree, so a
// route can die with ERR_CONNECTION_REFUSED through no fault of the page.
// Wait for it to answer again rather than losing the rest of the crawl.
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/login')
      if (r.ok) return true
    } catch { /* still down */ }
    await new Promise(res => setTimeout(res, 2000))
  }
  return false
}

async function main() {
  const h = await open()
  const out: Record<string, unknown> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
  for (const r of ROUTES) {
    const prev = out[r] as { error?: string } | undefined
    if (prev && !prev.error && !process.env.FORCE) { console.log(r, '(cached)'); continue }
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        // Dev compiles each route on first hit, which can take a minute on a
        // machine with several agents on it. Give it room, then let the client
        // components paint before reading the controls off the page.
        const resp = await h.page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 120000 })
        await h.page.waitForTimeout(3500)
        const v = await vocab(h.page)
        out[r] = { status: resp?.status() ?? null, landedOn: h.page.url().replace(BASE, ''), ...v }
        console.log(r, '->', (out[r] as { landedOn: string }).landedOn, '|', (v.h1[0] ?? v.headings[0] ?? '').slice(0, 55))
        done = true
      } catch (e) {
        const msg = String(e)
        if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ERR_EMPTY_RESPONSE')) {
          console.log(r, '… server down, waiting')
          await waitForServer()
        } else {
          out[r] = { error: msg.slice(0, 200) }
          console.log(r, 'ERROR', msg.slice(0, 100))
          done = true
        }
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  }
  await close(h)
}
main()
