/**
 * Does a paid digital product's download URL reach the browser before purchase?
 * npx tsx tests/audit/client-shop-payload.ts
 */
import fs from 'node:fs'
import { loginAs, close, FIX, BASE } from './client-lib'

const LOG = 'tests/audit/out/shop-payload.log'
fs.mkdirSync('tests/audit/out', { recursive: true })
const say = (s: string) => { console.log(s); fs.appendFileSync(LOG, s + '\n') }
fs.writeFileSync(LOG, '')

async function main() {
  const h = await loginAs('audit.owner@pupaudit.test', 'AuditPup2026!', { activeClientId: FIX.clientOwnerA })
  const { page } = h
  await page.goto(BASE + '/my-shop', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForTimeout(3000)
  const html = await page.content()
  fs.writeFileSync('tests/audit/out/shop.html', html)
  say('download url in payload: ' + html.includes('puppy-guide.pdf'))
  say('hidden product in payload: ' + html.includes('Audit Hidden Clicker'))
  say('out-of-stock product listed: ' + html.includes('Audit Long Line'))
  const i = html.indexOf('puppy-guide.pdf')
  if (i >= 0) say('context: ' + html.slice(Math.max(0, i - 140), i + 60).replace(/\s+/g, ' '))
  await close(h)
  say('DONE')
}
main().catch(e => { say('FATAL ' + String(e)); process.exit(1) })
