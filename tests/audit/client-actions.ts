/**
 * Pass 2 — BOOKING + BUYING as the established client of trainer A.
 * Every call goes through the real API with the client's own cookies.
 * npx tsx tests/audit/client-actions.ts
 */
import fs from 'node:fs'
import { loginAs, api, close, FIX } from './client-lib'

fs.mkdirSync('tests/audit/out', { recursive: true })
const LOG = 'tests/audit/out/client-actions.log'
fs.writeFileSync(LOG, '')
const say = (s: string) => { console.log(s); fs.appendFileSync(LOG, s + '\n') }

async function main() {
  const h = await loginAs('audit.owner@pupaudit.test', 'AuditPup2026!', { activeClientId: FIX.clientOwnerA })
  const { page } = h
  await page.goto('http://localhost:7777/home', { waitUntil: 'load', timeout: 90000 })

  const call = async (label: string, path: string, body?: unknown, method = 'POST') => {
    const r = await api(page, path, { method, body })
    say(`${label}\n   ${method} ${path}\n   -> ${r.status} ${r.body.slice(0, 400).replace(/\n/g, ' ')}`)
    return r
  }

  say('== SELF-BOOK A 1:1 ==')
  const list = await api(page, '/api/my/self-book')
  say(`self-book list -> ${list.status} ${list.body.slice(0, 200)}`)
  // Next Wednesday 10:00 NZ — inside the seeded 09:00–17:00 window.
  const d = new Date(); d.setDate(d.getDate() + 9); d.setHours(10, 0, 0, 0)
  const startDate = d.toISOString()
  await call('book 1:1', '/api/my/self-book', { packageId: FIX.packages.p1to1, startDate })
  await call('book 1:1 IN THE PAST', '/api/my/self-book', { packageId: FIX.packages.p1to1, startDate: new Date(Date.now() - 5 * 86400000).toISOString() })
  await call('book 1:1 at 3am (outside availability)', '/api/my/self-book', { packageId: FIX.packages.p1to1, startDate: new Date(new Date().setDate(new Date().getDate() + 10)).toISOString().replace(/T.*/, 'T15:00:00.000Z') })

  say('== BOOK A GROUP CLASS ==')
  await call('enrol class (FULL)', `/api/my/classes/${FIX.runs.runClass}/enroll`, { type: 'FULL', dogId: FIX.dogs.bella })
  await call('enrol class AGAIN (double book)', `/api/my/classes/${FIX.runs.runClass}/enroll`, { type: 'FULL', dogId: FIX.dogs.bella })

  say('== SEVERAL CASUAL DATES AT ONCE ==')
  await call('drop-in x3', `/api/my/classes/${FIX.runs.runDropIn}/enroll`, {
    type: 'DROP_IN', sessionIds: FIX.sessions.dropIn.slice(0, 3), dogId: FIX.dogs.bella,
  })
  say('== A CASUAL DATE IN THE PAST ==')
  await call('drop-in PAST date', `/api/my/classes/${FIX.runs.runDropIn}/enroll`, {
    type: 'DROP_IN', sessionIds: [FIX.sessions.pastDropIn], dogId: FIX.dogs.bella,
  })

  say('== EVENT TICKETS ==')
  await call('event, no tier named', `/api/my/classes/${FIX.runs.runEvent}/enroll`, { type: 'FULL' })
  await call('event, early bird x2', `/api/my/classes/${FIX.runs.runEvent}/enroll`, { type: 'FULL', ticketTierId: FIX.tiers.early, quantity: 2 })
  await call('event, early bird x2 AGAIN (tier cap 2)', `/api/my/classes/${FIX.runs.runEvent}/enroll`, { type: 'FULL', ticketTierId: FIX.tiers.early, quantity: 2 })

  say('== SOMETHING FULL / FINISHED / HIDDEN ==')
  await call('FULL class', `/api/my/classes/${FIX.runs.runFull}/enroll`, { type: 'FULL' })
  await call('FINISHED class', `/api/my/classes/${FIX.runs.runPast}/enroll`, { type: 'FULL' })
  await call('NOT-YET-VISIBLE class', `/api/my/classes/${FIX.runs.runHidden}/enroll`, { type: 'FULL' })
  await call('waitlist on hidden offering', '/api/my/waitlist', { packageId: FIX.packages.pHidden })
  await call('self-book the hidden offering', '/api/my/self-book', { packageId: FIX.packages.pHidden, start: new Date(Date.now() + 86400000).toISOString() })

  say('== ANOTHER TRAINER\'S THINGS ==')
  await call('trainer B package self-book', '/api/my/self-book', { packageId: FIX.bPackageId, start: new Date(Date.now() + 86400000).toISOString() })
  await call('trainer B product request', `/api/my/products/${FIX.products.rivalB}/request`, {})

  say('== SHOP ==')
  await call('plain product', `/api/my/products/${FIX.products.plain}/request`, {})
  await call('varianted product with NO option', `/api/my/products/${FIX.products.variant}/request`, {})
  await call('variant Small (stock 5)', `/api/my/products/${FIX.products.variant}/request`, { variantId: FIX.variants.s })
  await call('variant Medium (stock 0)', `/api/my/products/${FIX.products.variant}/request`, { variantId: FIX.variants.m })
  await call('variant Large (price inherits)', `/api/my/products/${FIX.products.variant}/request`, { variantId: FIX.variants.l })
  await call('digital download', `/api/my/products/${FIX.products.digital}/request`, {})
  await call('out of stock product', `/api/my/products/${FIX.products.oos}/request`, {})
  await call('HIDDEN (inactive) product', `/api/my/products/${FIX.products.hidden}/request`, {})

  say('== CANCEL A REQUEST — does the money and the stock come back? ==')
  await call('cancel plain product', `/api/my/products/${FIX.products.plain}/request`, undefined, 'DELETE')

  say('== MEMBERSHIP ==')
  await call('buy membership', `/api/my/memberships/${FIX.membershipId}/buy`, {})

  say('== BASKET CHECKOUT ==')
  await call('basket: product + class', '/api/my/basket/checkout', {
    lines: [
      { kind: 'PRODUCT', key: 'p1', productId: FIX.products.plain, quantity: 2 },
      { kind: 'CLASS', key: 'c1', classRunId: FIX.runs.runDropIn, type: 'DROP_IN', sessionIds: [FIX.sessions.dropIn[3]], dogIds: [FIX.dogs.bella] },
    ],
  })
  await call('basket: HIDDEN product', '/api/my/basket/checkout', {
    lines: [{ kind: 'PRODUCT', key: 'x', productId: FIX.products.hidden, quantity: 1 }],
  })

  say('== CANCEL A SESSION ==')
  await call('cancel my upcoming 1:1', `/api/my/sessions/${FIX.sessions.upcoming}/cancel`, {})
  await call('cancel ANOTHER client\'s session', `/api/my/sessions/${FIX.sessions.other}/cancel`, {})

  await close(h)
  say('DONE')
}
main().catch(e => { say('FATAL ' + String(e)); process.exit(1) })
