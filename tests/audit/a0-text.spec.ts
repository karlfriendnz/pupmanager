import { test } from '@playwright/test'
import { tab } from './helpers'
const TABS = (process.env.TABS || 'notifications,integrations,activity,billing,emails,forms,locations').split(',')
test('text dump', async ({ page }) => {
  test.setTimeout(300000)
  const errs: string[] = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 200)))
  for (const t of TABS) {
    await tab(page, t)
    await page.waitForTimeout(2500)
    const txt = await page.evaluate(() => {
      const nav = document.querySelector('nav')
      if (nav) (nav as HTMLElement).style.display = 'none'
      const t = document.body.innerText
      if (nav) (nav as HTMLElement).style.display = ''
      return t
    })
    console.log(`===== ${t}\n${txt.slice(0, 2500)}`)
  }
  console.log('CONSOLE ERRORS', JSON.stringify(errs.slice(0, 20), null, 1))
})
