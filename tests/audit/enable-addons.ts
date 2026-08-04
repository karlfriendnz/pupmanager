// Audit-only: switch on every available add-on for the throwaway audit trainer,
// through the real Add-ons UI, so every help article's screen is reachable.
// Run: npx tsx tests/audit/enable-addons.ts
import { open, close, vocab, BASE } from './helpdocs-lib'
import fs from 'fs'

async function main() {
  const h = await open()
  await h.page.goto(BASE + '/settings?tab=addons', { waitUntil: 'domcontentloaded' })
  await h.page.waitForTimeout(2500)
  const before = await vocab(h.page)
  fs.writeFileSync('tests/audit/out/addons-before.json', JSON.stringify(before, null, 2))

  // Toggles are switch-role buttons inside each add-on card.
  for (let pass = 0; pass < 3; pass++) {
    const turned = await h.page.evaluate(`(() => {
      const sw = Array.from(document.querySelectorAll('[role="switch"]'));
      const off = sw.filter(s => s.getAttribute('aria-checked') === 'false' && !s.disabled);
      off.forEach(s => s.click());
      return { total: sw.length, clicked: off.length };
    })()`)
    console.log('pass', pass, turned)
    await h.page.waitForTimeout(4000)
    if ((turned as { clicked: number }).clicked === 0) break
    await h.page.reload({ waitUntil: 'domcontentloaded' })
    await h.page.waitForTimeout(2500)
  }

  const after = await vocab(h.page)
  fs.writeFileSync('tests/audit/out/addons-after.json', JSON.stringify(after, null, 2))
  console.log('switch states:', await h.page.evaluate(`Array.from(document.querySelectorAll('[role="switch"]')).map(s => s.getAttribute('aria-checked')).join(',')`))
  await close(h)
}
main()
