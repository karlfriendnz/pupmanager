// UX-audit only: the CLIENT app at 390, 760 and 1440. Split from ux-sweep.ts
// so the trainer pass (which is much longer) can run at the same time without
// the two fighting over one widths list.
// Run: npx tsx tests/audit/ux-sweep-client.ts
import { open, close, probe, BASE } from './ux-lib'
import fs from 'fs'

const ROUTES = [
  '/home', '/my-sessions', '/my-homework', '/my-dogs', '/my-achievements', '/my-messages',
  '/my-invoices', '/my-shop', '/my-memberships', '/my-availability', '/my-notifications',
  '/my-profile', '/my-help', '/basket', '/switch-trainer',
]

const WIDTHS = [
  { w: 390, h: 844, tag: '390' },
  { w: 760, h: 560, tag: '760' },
  { w: 1440, h: 900, tag: '1440' },
]

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/login')).ok) return true } catch { /* down */ }
    await new Promise(r => setTimeout(r, 3000))
  }
  return false
}

async function main() {
  const file = 'tests/audit/out/ux-client.json'
  const out: Record<string, Record<string, unknown>> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  for (const { w, h, tag } of WIDTHS) {
    await waitForServer()
    const s = await open('client', { width: w, height: h })
    for (const r of ROUTES) {
      let done = false
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const resp = await s.page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 60000 })
          await s.page.waitForTimeout(1700)
          const p = await probe(s.page)
          out[r] = out[r] ?? {}
          out[r][tag] = { status: resp?.status() ?? null, landed: s.page.url().replace(BASE, ''), ...p }
          console.log(`${tag}  ${r} -> ${(out[r][tag] as { landed: string }).landed}${p.docOverflow > 0 ? ' OVERFLOW+' + p.docOverflow : ''}`)
          done = true
        } catch (e) {
          if (String(e).includes('ERR_CONNECTION_REFUSED')) { await waitForServer(); continue }
          out[r] = out[r] ?? {}
          out[r][tag] = { error: String(e).slice(0, 160) }
          console.log(`${tag}  ${r} ERROR ${String(e).slice(0, 90)}`)
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
