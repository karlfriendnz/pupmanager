/**
 * Pass 3 — a BRAND NEW dog owner: sign up, verify, get accepted, do the intake.
 * npx tsx tests/audit/client-signup.ts
 */
import fs from 'node:fs'
import { chromium } from '@playwright/test'
import { BASE, FIX, LEAKS } from './client-lib'

fs.mkdirSync('tests/audit/out', { recursive: true })
const LOG = 'tests/audit/out/client-signup.log'
fs.writeFileSync(LOG, '')
const say = (s: string) => { console.log(s); fs.appendFileSync(LOG, s + '\n') }

const stamp = Date.now().toString(36)
const NEW = { email: `newpup.${stamp}@pupauditsignup.test`, password: 'AuditPup2026!', name: 'Newby Newton' }

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

  const go = async (p: string) => {
    const r = await page.goto(BASE + p, { waitUntil: 'load', timeout: 90000 }).catch(e => { say('NAV ERR ' + p + ' ' + String(e).slice(0, 80)); return null })
    await page.waitForTimeout(1200)
    return { status: r?.status() ?? 0, url: page.url(), text: await page.evaluate(() => document.body?.innerText ?? '').catch(() => ''), html: await page.content().catch(() => '') }
  }

  say('== 1. the trainer\'s public join page (390px) ==')
  const join = await go(`/c/${'audit-paws-academy'}/join`)
  say(`  ${join.status} ${join.url}`)
  fs.writeFileSync('tests/audit/out/signup-join.txt', join.text)

  say('== 2. sign up ==')
  const signup = await page.evaluate(async (u) => {
    const r = await fetch('/api/auth/signup-client', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: u.name, email: u.email, password: u.password, phone: '021 555 0000', dogName: 'Comet', message: 'Hi!', trainerId: u.trainerId }),
    })
    return { status: r.status, body: (await r.text()).slice(0, 600) }
  }, { ...NEW, trainerId: FIX.trainerA })
  say(`  signup-client -> ${signup.status} ${signup.body}`)

  say('== 3. can they sign in BEFORE verifying? ==')
  await page.goto(BASE + '/login', { waitUntil: 'load' })
  await page.fill('input[type="email"], input[name="email"]', NEW.email)
  await page.fill('input[type="password"], input[name="password"]', NEW.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
  say(`  after sign-in -> ${page.url()}`)
  const afterLogin = await page.evaluate(() => document.body?.innerText ?? '')
  fs.writeFileSync('tests/audit/out/signup-after-login.txt', afterLogin)
  say('  text: ' + JSON.stringify(afterLogin.slice(0, 400)))

  say('== 4. can an unaccepted signup reach the client app? ==')
  for (const p of ['/home', '/my-sessions', '/my-shop', '/my-invoices']) {
    const r = await go(p)
    const lk = Object.entries(LEAKS).filter(([, v]) => r.html.includes(v)).map(([k]) => k)
    say(`  ${p} -> ${r.status} ${r.url.replace(BASE, '')}${lk.length ? ' ***LEAK ' + lk.join(',') : ''}`)
  }

  fs.writeFileSync('tests/audit/out/signup-account.json', JSON.stringify(NEW))
  if (errs.length) say('CONSOLE ERRORS: ' + JSON.stringify([...new Set(errs)].slice(0, 8)))
  await browser.close()
  say('DONE — account ' + NEW.email)
}
main().catch(e => { say('FATAL ' + String(e)); process.exit(1) })
