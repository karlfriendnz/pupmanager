// Audit pass 3 — drive the personalisation wizard for EVERY persona and check
// the add-ons each answer claims to switch on actually end up on (and that the
// "no" answers switch the default-on ones off).
// Run: npx tsx tests/audit/signup/03-wizard.ts [persona] [mode]
import { chromium, type Page, type Browser } from 'playwright'
import { api, db, BASE, freshIp } from './lib'

const PERSONAS = ['walker', 'trainer', 'behaviourist', 'groomer', 'petsitter', 'puppyschool', 'other']
const PERSONA_LABEL: Record<string, string> = {
  walker: 'Dog walker', trainer: 'Dog trainer', behaviourist: 'Behavior consulting',
  groomer: 'Groomer', petsitter: 'Pet sitter', puppyschool: 'Puppy school', other: 'Other',
}
const PW = 'AuditPass123!'

/** Answers that CLAIM to switch an add-on on, per onboarding-recommendations.ts */
const ADDON_ANSWERS: Record<string, string> = {
  'invoice your clients': 'Accounting software',   // + Xero follow-up -> xero
  'add your team': 'Yes, add my team',             // -> timesheets
  'Where do you see your clients': 'I travel to them', // -> routeplanner
  'sell products': 'Yes, I already do',            // -> shop
  'celebrate your clients': 'Yes, I already do',   // -> achievements
  'record session notes': 'Yes',                   // core: notes ON
  'interact with the system': 'Mobile app',        // core: clientapp ON
}
/** Answers that should switch the default-on core add-ons OFF. */
const OFF_ANSWERS: Record<string, string> = {
  'invoice your clients': 'Not sure yet',
  'add your team': 'Just me',
  'Where do you see your clients': 'They come to me',
  'sell products': 'No',
  'celebrate your clients': 'No',
  'record session notes': 'No',                    // core: notes OFF
  'interact with the system': 'No interaction',    // core: clientapp OFF
}
/** Package options that are NOT class-style (so `classes` should go off). */
const NON_CLASS = ['1:1 training', 'Board & train', 'Solo walks', 'Pack walks', 'Drop-in visits',
  'Assessments', 'Behaviour programmes', '1:1 sessions', 'Full groom', 'Bath & tidy', 'Nail trims',
  'De-shedding', 'Home visits', 'Overnight stays', 'House sitting']

async function makeTrainer(tag: string) {
  const email = `wizaudit.${tag}.${Date.now()}@pupaudit.test`
  const r = await api('/api/auth/signup', {
    method: 'POST', ip: freshIp(),
    body: JSON.stringify({
      name: `Wiz ${tag}`, businessName: `Wiz ${tag} Co`, phone: '+64 21 555 0101',
      email, password: PW, signupCountry: 'NZ',
    }),
  })
  if (r.status !== 201) throw new Error(`signup failed ${r.status} ${r.text}`)
  await db(`update users set "emailVerified" = now() at time zone 'UTC' where email = $1`, [email])
  const [row] = await db(`select p.id from trainer_profiles p join users u on u.id=p."userId" where u.email=$1`, [email])
  return { email, trainerId: row.id }
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PW)
  const done = async () =>
    page.evaluate(() => !!document.querySelector('.fixed.inset-0.z-50') || !location.pathname.startsWith('/login')).catch(() => false)
  for (let i = 0; i < 8; i++) {
    await page.locator('button[type="submit"]').evaluate((el: HTMLElement) => el.click()).catch(() => {})
    for (let j = 0; j < 12; j++) {
      await page.waitForTimeout(1000)
      if (await done()) { await page.waitForLoadState('domcontentloaded'); return }
    }
  }
  throw new Error('login never completed')
}

/** Click a wizard button whose text contains `text`. Real DOM click — this
 *  app's React handlers ignore Playwright's synthetic mouse events. */
async function clickText(page: Page, text: string) {
  await page.waitForFunction((t: string) => {
    const root = document.querySelector('.fixed.inset-0.z-50')
    if (!root) return false
    const hit = ([...root.querySelectorAll('button, a')] as HTMLElement[])
      .find(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim().includes(t))
    if (!hit || (hit as HTMLButtonElement).disabled) return false
    hit.click()
    return true
  }, text, { timeout: 45000 })
  await page.waitForTimeout(150)
}

async function heading(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('.fixed.inset-0.z-50 h2')?.textContent ?? '').replace(/\s+/g, ' ').trim())
}
async function options(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0.z-50 button[aria-pressed]')]
    .map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim()))
}
/** Continue, then wait for the screen to actually change. */
async function advance(page: Page, from: string) {
  await clickText(page, 'Continue')
  await page.waitForFunction((prev: string) => {
    const r = document.querySelector('.fixed.inset-0.z-50')
    if (!r) return true
    return (r.querySelector('h2')?.textContent ?? '').replace(/\s+/g, ' ').trim() !== prev
  }, from, { timeout: 60000 }).catch(() => {})
}

export type Journey = {
  persona: string; mode: string; email: string; trainerId: string
  screens: { heading: string; options: string[]; picked: string }[]
  addons: { itemId: string; active: boolean }[]
  roles: any; notes: string[]
}

async function runPersona(browser: Browser, persona: string, mode: 'on' | 'off'): Promise<Journey> {
  const notes: string[] = []
  const { email, trainerId } = await makeTrainer(`${persona}.${mode}`)
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-forwarded-for': freshIp() },
  })
  const page = await ctx.newPage()
  const netErrors: string[] = []
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) netErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.on('pageerror', e => notes.push(`PAGE ERROR: ${e.message}`))

  await login(page, email)
  await page.waitForSelector('.fixed.inset-0.z-50', { timeout: 30000 }).catch(() => notes.push('WIZARD DID NOT APPEAR'))
  const screens: Journey['screens'] = []

  // welcome -> business -> contact -> colour
  for (const s of ['Welcome to PupManager', 'Make it yours', 'Contact details', 'Your colour']) {
    const h = await heading(page)
    if (!h.includes(s.slice(0, 10))) notes.push(`expected "${s}", got "${h}"`)
    await advance(page, h)
  }

  // roles
  let h = await heading(page)
  if (!/line of work/i.test(h)) notes.push(`expected role picker, got "${h}"`)
  screens.push({ heading: h, options: await options(page), picked: PERSONA_LABEL[persona] })
  await clickText(page, PERSONA_LABEL[persona])
  await advance(page, h)

  // take a look -> keep setting up
  h = await heading(page)
  if (!/look first/i.test(h)) notes.push(`expected take-a-look, got "${h}"`)
  screens.push({ heading: h, options: [], picked: 'Keep setting up' })
  await clickText(page, 'Keep setting up')
  await page.waitForTimeout(400)

  // the question screens
  for (let guard = 0; guard < 15; guard++) {
    h = await heading(page)
    if (/say hello|what do you want to capture|you.re set|you.re all set|how do you want to start/i.test(h)) break
    const opts = await options(page)
    if (!opts.length) { notes.push(`no options on "${h}"`); break }

    if (/what do you offer/i.test(h)) {
      // 'on' mode ticks everything (so `classes` should end up ON);
      // 'off' mode ticks only non-class offerings (so `classes` should go OFF).
      const pickThese = mode === 'on' ? opts : opts.filter(o => NON_CLASS.some(n => o.includes(n)))
      for (const o of (pickThese.length ? pickThese : [opts[0]])) await clickText(page, o)
      screens.push({ heading: h, options: opts, picked: (pickThese.length ? pickThese : [opts[0]]).join(' + ') })
      await advance(page, h)
      continue
    }

    const table = mode === 'on' ? ADDON_ANSWERS : OFF_ANSWERS
    const key = Object.keys(table).find(k => h.includes(k))
    const want = key ? table[key] : null
    const choice = (want && opts.find(o => o.includes(want))) ?? opts[0]
    await clickText(page, choice)
    if (mode === 'on' && /invoice your clients/i.test(h)) {
      await clickText(page, 'Xero').catch(() => notes.push('Xero follow-up missing'))
    }
    screens.push({ heading: h, options: opts, picked: choice })
    await advance(page, h)
  }

  // Walk out to the ending, then choose "start fresh".
  for (let guard = 0; guard < 8; guard++) {
    h = await heading(page)
    if (/how do you want to start/i.test(h)) break
    await advance(page, h)
  }
  h = await heading(page)
  if (/how do you want to start/i.test(h)) {
    await clickText(page, 'Set up my real business')
    await page.waitForTimeout(4000)
  } else {
    notes.push(`never reached the ending; last heading "${h}"`)
  }

  const addons = await db(`select "itemId", active from trainer_addons where "trainerId"=$1 order by "itemId"`, [trainerId])
  const [prof] = await db(`select "businessRoles","landingPage" is null as x from trainer_profiles where id=$1`, [trainerId]).catch(() => [{}] as any)
  const [u] = await db(`select u."landingPage" from users u join trainer_profiles p on p."userId"=u.id where p.id=$1`, [trainerId])
  notes.push(`landingPage=${u?.landingPage}`)
  if (netErrors.length) notes.push(`API errors: ${[...new Set(netErrors)].join(', ')}`)
  await ctx.close()
  return { persona, mode, email, trainerId, screens, addons, roles: prof?.businessRoles, notes }
}

async function main() {
  const only = process.argv[2]
  const onlyMode = process.argv[3] as 'on' | 'off' | undefined
  const browser = await chromium.launch()
  const list = only && only !== 'all' ? [only] : PERSONAS
  const modes: ('on' | 'off')[] = onlyMode ? [onlyMode] : ['on', 'off']
  for (const p of list) {
    for (const mode of modes) {
      try {
        const j = await runPersona(browser, p, mode)
        console.log(`\n##### ${j.persona} / ${j.mode}  (${j.email})`)
        j.screens.forEach(s => console.log(`   [${s.heading}] -> ${s.picked}`))
        console.log(`   ROLES: ${JSON.stringify(j.roles)}`)
        console.log(`   ADDON ROWS: ${j.addons.length ? j.addons.map(a => `${a.itemId}=${a.active}`).join(', ') : '(none)'}`)
        j.notes.forEach(n => console.log(`   NOTE: ${n}`))
      } catch (e: any) {
        console.log(`\n##### ${p} / ${mode}  CRASHED: ${e.message.split('\n')[0]}`)
      }
    }
  }
  await browser.close()
}
main().catch(e => { console.error(e); process.exit(1) })
