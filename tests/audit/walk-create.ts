// Audit-only: follow the CREATE articles' steps literally, in the running app.
// Verifies the steps AND leaves behind the data later screens need.
// Run: npx tsx tests/audit/walk-create.ts
import { open, close, vocab, clickByText, BASE } from './helpdocs-lib'
import type { Page } from '@playwright/test'
import fs from 'fs'

const log: string[] = []
function say(s: string) { console.log(s); log.push(s) }

async function snap(page: Page, label: string) {
  const v = await vocab(page)
  say(`  [${label}] url=${v.url}`)
  say(`    buttons: ${JSON.stringify(v.buttons.slice(0, 25))}`)
  say(`    headings: ${JSON.stringify(v.headings.slice(0, 15))}`)
  say(`    labels: ${JSON.stringify(v.labels.slice(0, 20))}`)
  return v
}

async function main() {
  const h = await open()
  const page = h.page

  // ── Article: add-client / invite-client / quick-add-contact ────────────────
  // Step 1: 'Click the "+" button — top right on a computer'
  say('== the "+" create button ==')
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const plus = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('header button, button'));
    const hit = btns.filter(b => {
      const l = (b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.innerText || '');
      return /create|new|add|\\+/i.test(l);
    }).map(b => ({ label: b.getAttribute('aria-label'), title: b.title, text: (b.innerText||'').trim().slice(0,30) }));
    return hit.slice(0, 12);
  })()`)
  say('  plus candidates: ' + JSON.stringify(plus))

  const opened = await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      b => /create|new/i.test(b.getAttribute('aria-label') || ''));
    if (!b) return false; b.click(); return b.getAttribute('aria-label');
  })()`)
  say('  clicked: ' + JSON.stringify(opened))
  await page.waitForTimeout(1500)
  await snap(page, 'create menu')

  fs.writeFileSync('tests/audit/out/walk-create.log', log.join('\n'))
  await close(h)
}
main()
