import { chromium } from '@playwright/test'
const EMAIL = process.argv[2], PW = process.argv[3]
;(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 844 } })
  const page = await c.newPage()
  await page.goto('http://localhost:7777/login', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PW)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(9000)
  console.log('URL:', page.url())
  console.log('TEXT:', (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 700))
  await b.close()
})()
