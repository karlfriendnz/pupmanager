/**
 * Pass 1 — page sweep + leak probes as the ESTABLISHED client of trainer A.
 * Patient: the shared dev server is under heavy contention during the audit.
 * npx tsx tests/audit/client-probe.ts   (writes tests/audit/out/client-probe.log)
 */
import fs from 'node:fs'
import { loginAs, api, close, FIX, LEAKS, BASE } from './client-lib'
import type { Page } from '@playwright/test'

fs.mkdirSync('tests/audit/out', { recursive: true })
const LOG = 'tests/audit/out/client-probe.log'
fs.writeFileSync(LOG, '')
const say = (s: string) => { console.log(s); fs.appendFileSync(LOG, s + '\n') }

const PAGES = [
  '/home', '/my-sessions', '/my-dogs', '/my-shop', '/my-invoices',
  '/my-messages', '/my-profile', '/my-availability', '/my-achievements',
  '/my-memberships', '/my-notifications', '/my-help', '/switch-trainer',
]

async function visit(page: Page, path: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 180000 })
      await page.waitForTimeout(1500)
      return { status: res?.status() ?? 0, url: page.url(), html: await page.content(), text: await page.evaluate(() => document.body?.innerText ?? '') }
    } catch (e) {
      if (i === 2) return { status: -1, url: page.url(), html: '', text: 'ERR ' + String(e).slice(0, 100) }
      await page.waitForTimeout(4000)
    }
  }
  return { status: -1, url: '', html: '', text: '' }
}

const leaksIn = (s: string) => Object.entries(LEAKS).filter(([, v]) => s.includes(v)).map(([k]) => k)

async function main() {
  const h = await loginAs('audit.owner@pupaudit.test', 'AuditPup2026!', { activeClientId: FIX.clientOwnerA })
  const { page } = h
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  say('### landed on ' + page.url())

  for (const p of PAGES) {
    const r = await visit(page, p)
    const lk = leaksIn(r.html)
    say(`PAGE ${p} -> ${r.status} ${r.url.replace(BASE, '')} len=${r.text.length}${lk.length ? '  ***LEAK: ' + lk.join(',') : ''}`)
    fs.writeFileSync('tests/audit/out/A' + p.replace(/\//g, '_') + '.txt', r.text)
  }

  for (const [name, id] of Object.entries(FIX.sessions as Record<string, string | string[]>)) {
    if (Array.isArray(id)) continue
    const r = await visit(page, `/my-sessions/${id}`)
    const lk = leaksIn(r.html)
    say(`SESSION ${name} -> ${r.status} ${r.url.replace(BASE, '')}${lk.length ? '  ***LEAK: ' + lk.join(',') : ''}`)
    fs.writeFileSync(`tests/audit/out/A-session-${name}.txt`, r.text)
  }

  const rInv = await visit(page, `/my-invoices/${FIX.invoices.otherToken}`)
  say(`OTHER INVOICE /my-invoices/<token> -> ${rInv.status} leak=${rInv.html.includes(LEAKS.OTHER_INVOICE)}`)
  const rPay = await visit(page, `/pay/${FIX.invoices.otherToken}`)
  say(`OTHER INVOICE /pay/<token>         -> ${rPay.status} leak=${rPay.html.includes(LEAKS.OTHER_INVOICE)}`)

  for (const [n, u] of [
    ['products', '/api/my/products'],
    ['self-book', '/api/my/self-book'],
  ] as [string, string][]) {
    const r = await api(page, u)
    const lk = leaksIn(r.body)
    say(`API ${n} -> ${r.status}${lk.length ? ' ***LEAK: ' + lk.join(',') : ''}`)
    fs.writeFileSync(`tests/audit/out/A-api-${n}.json`, r.body)
  }

  if (errors.length) say('CONSOLE ERRORS: ' + JSON.stringify([...new Set(errors)].slice(0, 10)))
  await close(h)
  say('DONE')
}
main().catch(e => { say('FATAL ' + String(e)); process.exit(1) })
