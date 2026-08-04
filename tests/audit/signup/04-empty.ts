// Audit pass 4 — what a BRAND-NEW trainer meets. Visit every static trainer
// screen on an account with no clients, no offerings, no products, and report
// anything that crashes, 500s, throws in the browser, or reads badly empty.
// Run: npx tsx tests/audit/signup/04-empty.ts
import { chromium, type Page } from 'playwright'
import { api, db, BASE, freshIp } from './lib'

const PW = 'AuditPass123!'

// Every static (non-parameterised) trainer route.
const ROUTES = [
  '/dashboard', '/schedule', '/schedule/route', '/clients', '/clients/invite', '/clients/waitlist',
  '/offerings', '/offerings/new', '/offerings/tags', '/packages', '/classes', '/casual-classes',
  '/doggy-daycare', '/events', '/memberships', '/products', '/products/new', '/products/categories',
  '/library', '/templates', '/templates/new', '/progress', '/achievements', '/achievements/new',
  '/awards', '/messages', '/notifications', '/enquiries', '/forms/intake', '/forms/new',
  '/forms/client/new', '/forms/embed/new', '/forms/session/new', '/marketing', '/marketing/new',
  '/lead-magnets', '/instagram', '/website', '/finances', '/finances/stripe', '/reports',
  '/timesheets', '/sessions/draft-notes', '/sessions/needs-notes', '/settings', '/add-ons',
  '/ai-tools', '/help', '/billing/setup', '/connect-preview', '/doggy-daycare',
]

async function makeTrainer() {
  const email = `emptyaudit.${Date.now()}@pupaudit.test`
  const r = await api('/api/auth/signup', {
    method: 'POST', ip: freshIp(),
    body: JSON.stringify({
      name: 'Empty Tester', businessName: 'Empty Kennels', phone: '+64 21 555 0202',
      email, password: PW, signupCountry: 'NZ',
    }),
  })
  if (r.status !== 201) throw new Error(`signup ${r.status} ${r.text}`)
  await db(`update users set "emailVerified" = now() at time zone 'UTC' where email=$1`, [email])
  const [p] = await db(`select p.id from trainer_profiles p join users u on u.id=p."userId" where u.email=$1`, [email])
  // Skip the first-run wizard so we see the real screens.
  await db(`insert into trainer_onboarding_progress ("id","trainerId","welcomeShownAt","checklistDismissedAt","createdAt","updatedAt")
            values (gen_random_uuid(), $1, now() at time zone 'UTC', now() at time zone 'UTC', now() at time zone 'UTC', now() at time zone 'UTC')
            on conflict ("trainerId") do update set "welcomeShownAt"=excluded."welcomeShownAt", "checklistDismissedAt"=excluded."checklistDismissedAt"`, [p.id])
  return { email, trainerId: p.id }
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PW)
  for (let i = 0; i < 8; i++) {
    await page.locator('button[type="submit"]').evaluate((el: HTMLElement) => el.click()).catch(() => {})
    for (let j = 0; j < 12; j++) {
      await page.waitForTimeout(1000)
      const done = await page.evaluate(() => !location.pathname.startsWith('/login')).catch(() => false)
      if (done) { await page.waitForTimeout(500); return }
    }
  }
  throw new Error('login never completed')
}

async function main() {
  // Slice the route list so each browser session stays short — several agents
  // share this dev server and long-lived contexts are what stall.
  const from = Number(process.argv[2] ?? 0)
  const to = Number(process.argv[3] ?? ROUTES.length)
  const slice = ROUTES.slice(from, to)
  const { email, trainerId } = await makeTrainer()
  console.log(`fresh trainer: ${email} (${trainerId})  routes ${from}..${to}\n`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': freshIp() } })
  const page = await ctx.newPage()
  await login(page, email)

  for (const route of slice) {
    const pageErrors: string[] = []
    const apiErrors: string[] = []
    const onErr = (e: Error) => pageErrors.push(e.message.split('\n')[0])
    const onRes = (r: any) => { if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`) }
    page.on('pageerror', onErr); page.on('response', onRes)
    let status = 0
    try {
      const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
      status = resp?.status() ?? 0
      await page.waitForTimeout(1800)
    } catch (e: any) {
      pageErrors.push(`NAV: ${e.message.split('\n')[0]}`)
    }
    const info = await page.evaluate(() => {
      const body = document.body.innerText.replace(/\s+/g, ' ').trim()
      return {
        url: location.pathname,
        chars: body.length,
        digest: /(Application error|Something went wrong|Unhandled Runtime Error|client-side exception|500|Internal Server Error)/i.exec(body)?.[0] ?? null,
        // Rough "reads badly" signal: an all-but-blank main region.
        mainChars: (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').trim().length,
        snippet: body.slice(0, 160),
      }
    }).catch(() => ({ url: route, chars: 0, digest: 'EVAL FAILED', mainChars: 0, snippet: '' }))
    page.off('pageerror', onErr); page.off('response', onRes)

    const bad = status >= 400 || !!info.digest || pageErrors.length > 0 || info.mainChars < 40
    const flag = bad ? 'FLAG' : ' ok '
    console.log(`${flag} ${route.padEnd(26)} http=${status} landed=${info.url} main=${info.mainChars}ch${info.digest ? ` DIGEST="${info.digest}"` : ''}`)
    if (pageErrors.length) console.log(`       pageerror: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`)
    if (apiErrors.length) console.log(`       api: ${[...new Set(apiErrors)].slice(0, 5).join(' | ')}`)
    if (bad) console.log(`       snippet: ${info.snippet}`)
  }
  await browser.close()
}
main().catch(e => { console.error(e); process.exit(1) })
