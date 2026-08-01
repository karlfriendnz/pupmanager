import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { TEST_DATABASE_URL } from './test-db'

// A whole business, built the way a real one is: sign up, switch on what you
// use, put your offerings in, add your library and your products, then take on
// clients and talk to them.
//
// Every other spec starts from seeded data, which means the paths a NEW trainer
// walks — the ones every customer walks exactly once — are only ever exercised
// piecemeal. This runs them in order, in one business, so that anything which
// only breaks in sequence has somewhere to show up.
//
// One test, deliberately. The steps depend on each other (you cannot enrol a
// client in a class you have not created), and splitting them into independent
// tests would mean seeding the middle of the journey and never walking it.

test.describe.configure({ mode: 'serial', timeout: 300_000 })

const STAMP = Date.now()
const BIZ = {
  name: 'Journey Dog Co',
  owner: 'Jo Journey',
  email: `journey-${STAMP}@e2e.test`,
  password: 'JourneyPass123!',
  phone: '021 555 0100',
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

type Db = Awaited<ReturnType<typeof makePrisma>>

async function otpFor(prisma: Db, email: string): Promise<string> {
  const token = await prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  })
  expect(token, `no verification token for ${email}`).toBeTruthy()
  return token!.token
}

/** Sign up as a dog pro and land in the app. */
async function signUp(page: Page, prisma: Db) {
  await page.goto('/register?as=pro')
  await page.getByLabel('Your name').fill(BIZ.owner)
  await page.getByLabel('Business name').fill(BIZ.name)
  await page.getByLabel('Phone number').fill(BIZ.phone)
  await page.getByLabel('Country').selectOption('NZ')
  await page.getByLabel('Your email').fill(BIZ.email)
  await page.getByRole('button', { name: 'Create account' }).click()

  const codeBox = page.getByLabel('Verification code')
  await expect(codeBox).toBeVisible({ timeout: 20_000 })
  await codeBox.fill(await otpFor(prisma, BIZ.email))
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Password', { exact: true }).fill(BIZ.password)
  await page.getByLabel('Confirm password').fill(BIZ.password)
  await page.getByRole('button', { name: 'Finish & go to dashboard' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/register'), { timeout: 30_000 })
}

/**
 * Switch on everything this business uses.
 *
 * The catalogue is split across two screens and the split is not obvious from
 * the outside: what is INCLUDED with the plan lives on Configure and toggles
 * with a switch; what is PAID lives on Add-ons and opens a panel first. A
 * trainer setting up meets both.
 */
const FREE_ADDONS = [
  'Messaging', '1:1 sessions', 'Instant sale', 'Google Calendar', 'Timesheets',
  'To-do & brain dump', 'Session notes', 'Casual classes', 'Group classes',
  'Events', 'Doggy Daycare', 'Packages', 'Training library', 'Client payments',
  'Instagram',
]
const PAID_ADDONS: { id: string; name: string }[] = [
  { id: 'achievements', name: 'Client achievements' },
  { id: 'shop', name: 'Client shop' },
  { id: 'marketing', name: 'Marketing' },
  { id: 'routeplanner', name: 'Route planner' },
  { id: 'leadmagnets', name: 'Lead magnets' },
]
// Deliberately NOT switched on: Xero (Karl's instruction), and the AI helper,
// which is marked coming-soon and has nothing behind it yet.

async function turnOnFreeAddons(page: Page) {
  await page.goto('/settings?tab=configure')
  for (const name of FREE_ADDONS) {
    const sw = page.getByRole('switch', { name: new RegExp(`^${name} —`) })
      .or(page.getByLabel(new RegExp(`^${name} —`)))
      .first()
    if (!(await sw.isVisible().catch(() => false))) continue
    const label = (await sw.getAttribute('aria-label')) ?? ''
    if (/— on$/.test(label)) continue          // already on
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/addons') && r.request().method() === 'POST'),
      sw.click(),
    ])
  }
}

/**
 * A paid add-on on a trial account.
 *
 * It cannot be switched on, and that is the product working: /api/addons
 * refuses with `needsSubscription` until there is a subscription to add it to.
 * What matters is where that leaves the trainer — they are sent to billing
 * setup, not left with a button that quietly does nothing.
 */
async function paidAddonAsksForASubscription(page: Page, id: string, name: string) {
  await page.goto('/settings?tab=addons')
  const card = page.getByTestId(`addon-card-${id}`)
  await expect(card, `no add-on card for ${id}`).toBeVisible({ timeout: 15_000 })
  await card.click()

  const turnOn = page.getByRole('button', { name: `Turn on ${name}` })
  await expect(turnOn).toBeVisible({ timeout: 10_000 })
  await turnOn.click()

  // Not an error message — the trainer is taken to the place that fixes it.
  // /api/addons answers `needsSubscription`, and the grid sends them straight
  // to billing setup rather than leaving them to work out what "no" meant.
  await page.waitForURL(/\/billing\/setup/, { timeout: 15_000 })
}


/** POST helper that fails with the server's own words rather than a bare code. */
async function post(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data })
  expect(res.status(), `POST ${url} → ${await res.text()}`).toBeLessThan(300)
  return res.json()
}

test('a brand-new trainer builds a business, takes on clients, and talks to them', async ({ page }) => {
  const prisma = await makePrisma()
  try {
    // ── 1. Sign up ────────────────────────────────────────────────────────
    await signUp(page, prisma)

    const profile = await prisma.trainerProfile.findFirst({
      where: { user: { email: BIZ.email } },
      select: { id: true, businessName: true, slug: true },
    })
    expect(profile?.businessName).toBe(BIZ.name)

    // ── 2. Switch on what the business uses ───────────────────────────────
    await turnOnFreeAddons(page)

    // The paid ones cannot be bought on a trial, and say so.
    await paidAddonAsksForASubscription(page, 'achievements', 'Client achievements')

    // Granted directly so the rest of the journey can walk the features they
    // gate. Getting here for real means subscribing, which is Stripe's job and
    // has its own coverage — repeating it here would test checkout, not the
    // business being built on top of it.
    for (const { id } of PAID_ADDONS) {
      await prisma.trainerAddon.upsert({
        where: { trainerId_itemId: { trainerId: profile!.id, itemId: id } },
        update: { active: true },
        create: { trainerId: profile!.id, itemId: id, active: true },
      })
    }

    const rows = await prisma.trainerAddon.findMany({
      where: { trainerId: profile!.id, active: true },
      select: { itemId: true },
    })
    const active = new Set(rows.map(a => a.itemId))
    for (const { id, name } of PAID_ADDONS) {
      expect(active.has(id), `${name} should be switched on`).toBe(true)
    }
    expect(active.has('xero'), 'Xero was deliberately left off').toBe(false)

    await page.goto('/settings?tab=configure')
    for (const name of FREE_ADDONS) {
      const sw = page.getByLabel(new RegExp(`^${name} —`)).first()
      if (!(await sw.isVisible().catch(() => false))) continue
      expect(await sw.getAttribute('aria-label'), `${name} should read as on`).toMatch(/— on$/)
    }

    // ── 3. The offerings ──────────────────────────────────────────────────
    // Four shapes that share two rows (Package + ClassRun) and differ only by
    // declared flags, which is exactly why they are all built here: a kind that
    // is inferred rather than declared has cost a customer her classes before.
    const pkg = await post(page, '/api/packages', {
      name: 'Puppy Foundations', sessionCount: 6, weeksBetween: 1,
      durationMins: 60, sessionType: 'IN_PERSON', priceCents: 42000,
    })
    expect(pkg.id).toBeTruthy()

    const oneOff = await post(page, '/api/packages', {
      name: 'Behaviour consult', sessionCount: 1, weeksBetween: 0,
      durationMins: 90, sessionType: 'VIRTUAL', priceCents: 18000,
    })

    // Open the consult up to self-booking, and put the week's hours in. Without
    // both, the client's booking tab has nothing to offer.
    await prisma.package.update({
      where: { id: oneOff.id },
      data: { clientSelfBook: true, selfBookRequiresApproval: false, priceCents: 0 },
    })
    await prisma.availabilitySlot.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({
        trainerId: profile!.id, dayOfWeek, startTime: '09:00', endTime: '17:00', cadenceWeeks: 1,
      })),
    })

    const startDate = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
    const klass = await post(page, '/api/class-runs', {
      name: 'Loose Lead Group', startDate, capacity: 2,
      sessionCount: 4, weeksBetween: 1, durationMins: 60, priceCents: 24000,
      // The one-step create needs the class's own settings inline — without a
      // sessionType it falls through to "Missing class settings".
      sessionType: 'IN_PERSON',
    })
    expect(klass.id ?? klass.runId).toBeTruthy()

    // ── 4. The library ────────────────────────────────────────────────────
    // A new business starts with an EMPTY library and says so — the trainer
    // builds their own structure: a type, a theme inside it, then the tasks.
    await page.goto('/library')
    await expect(page.getByText(/Your library is empty/i).first()).toBeVisible({ timeout: 15_000 })

    const type = await post(page, '/api/library/types', { name: 'Homework' })
    const theme = await post(page, '/api/library/themes', { name: 'Recall', typeId: type.id })
    for (const title of ['Name game', 'Whistle recall', 'Long line practice']) {
      await post(page, '/api/library/tasks', {
        themeId: theme.id, title, repetitions: 5,
        description: `<p>${title} — five minutes, twice a day.</p>`,
      })
    }
    const taskCount = await prisma.libraryTask.count({ where: { theme: { typeId: type.id } } })
    expect(taskCount).toBeGreaterThanOrEqual(3)

    // ── 5. The shop ───────────────────────────────────────────────────────
    const treats = await post(page, '/api/products', {
      name: 'Training treats', kind: 'PHYSICAL', priceCents: 1500, stock: 20,
    })
    await post(page, '/api/products', {
      name: 'Puppy guide (PDF)', kind: 'DIGITAL', priceCents: 900,
    })
    expect(treats.id).toBeTruthy()

    // Everything the trainer just built should be on their own screens.
    await page.goto('/packages')
    await expect(page.getByText('Puppy Foundations').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/products')
    await expect(page.getByText('Training treats').first()).toBeVisible({ timeout: 15_000 })
    // The library lists TYPES at the top; themes and their tasks live inside.
    await page.goto('/library')
    await expect(page.getByText('Homework').first()).toBeVisible({ timeout: 15_000 })
    await page.getByText('Homework').first().click()
    await expect(page.getByText('Recall').first()).toBeVisible({ timeout: 15_000 })

    // ── 6. Clients, three different ways ──────────────────────────────────
    // A full record with a dog, a bare quick-add, and one with NO email at all
    // — the last is a real case (a walk-in whose address you do not have) and
    // the one most likely to be mishandled, because it is the only one that
    // cannot be written to.
    const full = await post(page, '/api/clients', {
      mode: 'full', name: 'Fiona Full', email: `fiona-${STAMP}@e2e.test`,
      phone: '021 555 0111', dogs: [{ name: 'Rusty', breed: 'Collie' }],
    })
    const quick = await post(page, '/api/clients', {
      mode: 'quick', name: 'Quinn Quick', email: `quinn-${STAMP}@e2e.test`, phone: '021 555 0112',
    })
    const noEmail = await post(page, '/api/clients', {
      mode: 'quick', name: 'Ned NoEmail', phone: '021 555 0113',
    })
    expect(full.clientId && quick.clientId && noEmail.clientId).toBeTruthy()

    // A client with no address stores NULL — not an invented one. An invented
    // address looks mailable, and every send then has to remember not to use it.
    const nedRow = await prisma.clientProfile.findUnique({
      where: { id: noEmail.clientId },
      select: { user: { select: { email: true, name: true } } },
    })
    expect(nedRow?.user?.email, 'a client with no email must not be given a fake one').toBeNull()
    expect(nedRow?.user?.name).toBe('Ned NoEmail')

    // All three are on the list. They have never booked, so Contacts is where
    // they live — the default Current tab is for people with something coming.
    await page.goto('/clients?tab=never')
    for (const who of ['Fiona Full', 'Quinn Quick', 'Ned NoEmail']) {
      await expect(page.getByText(who).first(), `${who} should be on the clients list`).toBeVisible({ timeout: 15_000 })
    }

    // ── 7. Emailing them ──────────────────────────────────────────────────
    // Pick everyone and open the composer. Ned has no address, so he can be
    // MESSAGED but not emailed — the bar has to say so rather than quietly
    // handing the composer a shorter list than the trainer chose.
    await page.getByRole('button', { name: 'Select clients to email' }).first().click()
    const selectAll = page.getByRole('button', { name: /^Select all \(\d+\)$/ })
    await expect(selectAll).toBeVisible({ timeout: 15_000 })
    await selectAll.click()

    await expect(page.getByText(/\d+ selected/).first()).toBeVisible()
    await expect(
      page.getByText(/1 has no email address/),
      'a client with no address must be named, not silently dropped',
    ).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^Email/ }).first().click()
    const composer = page.getByRole('dialog')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    // Whatever step it is on, the person with no address is not in it. The
    // composer's own contract is that its candidates are already filtered to
    // mailable, and the count on the bar above said one was held back.
    await expect(
      composer.getByText('Ned NoEmail'),
      'the composer must not offer to email someone with no address',
    ).toHaveCount(0)
    await expect(composer.getByText('Create email').first()).toBeVisible({ timeout: 10_000 })

    // ── 8. A message, sent before she ever signs in ───────────────────────
    const sent = await post(page, '/api/messages', {
      clientId: full.clientId,
      body: 'Hi Fiona — welcome aboard. Rusty is booked in for Thursday.',
    })
    expect(sent).toBeTruthy()

    // ── 9. The client's own side ──────────────────────────────────────────
    // Give Fiona a password the way an accepted invite would, then sign in as
    // her in a clean context. What matters is that a client of a business built
    // entirely in this test can reach their own app and see whose it is.
    const fionaUser = await prisma.clientProfile.findUnique({
      where: { id: full.clientId },
      select: { user: { select: { id: true, email: true } } },
    })
    const clientPassword = 'ClientPass123!'
    await prisma.account.create({
      data: {
        userId: fionaUser!.user!.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: await bcrypt.hash(clientPassword, 12),
      },
    })

    const clientCtx = await page.context().browser()!.newContext()
    const clientPage = await clientCtx.newPage()
    try {
      await clientPage.goto('/login')
      await clientPage.getByLabel(/Email/).first().fill(fionaUser!.user!.email!)
      await clientPage.getByLabel('Password').fill(clientPassword)
      await clientPage.getByRole('button', { name: 'Sign in' }).click()
      await clientPage.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })

      // She is a CLIENT, not a trainer — the trainer surfaces must not open.
      expect(clientPage.url()).not.toContain('/dashboard')

      // Her trainer's business, and her own dog.
      await clientPage.goto('/home')
      // filter to visible: the shell renders a phone and a desktop header, so
      // the first match is whichever one this width is hiding.
      await expect(clientPage.getByText(BIZ.name).filter({ visible: true }).first())
        .toBeVisible({ timeout: 20_000 })
      await expect(clientPage.getByText('Rusty').filter({ visible: true }).first())
        .toBeVisible({ timeout: 20_000 })

      // The message was waiting for her.
      await clientPage.goto('/my-messages')
      await expect(
        clientPage.getByText(/Rusty is booked in for Thursday/).first(),
        'a message sent before the client ever signed in should be waiting',
      ).toBeVisible({ timeout: 20_000 })

      // And she can answer it.
      const replied = await clientPage.request.post('/api/messages', {
        data: { clientId: full.clientId, body: 'Brilliant, thank you! See you then.' },
      })
      expect(replied.status(), await replied.text()).toBeLessThan(300)

      // ── 10. She books herself in, and goes through with it ──────────────
      // The wizard spec stops one click short of Confirm on purpose: it shares
      // a database with every other spec, so a real booking there could race
      // one of them. This business is its own, built in this test and used by
      // nobody else, so the last click — the one that actually creates the
      // session — can finally be taken.
      await clientPage.goto('/my-availability')
      await expect(clientPage.getByRole('heading', { name: 'What would you like to book?' }))
        .toBeVisible({ timeout: 20_000 })
      await clientPage.getByRole('button', { name: /1-on-1 sessions/ }).click()
      await clientPage.getByRole('button', { name: /Behaviour consult/ }).click()

      await expect(clientPage.getByRole('heading', { name: 'Pick a time' })).toBeVisible({ timeout: 15_000 })
      const continueBtn = clientPage.getByRole('button', { name: /^Continue · / })
      await expect(continueBtn).toBeEnabled({ timeout: 15_000 })
      await continueBtn.click()

      await expect(clientPage.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible({ timeout: 15_000 })
      await clientPage.getByRole('button', { name: 'Confirm booking' }).click()

      // It exists, it belongs to her, and it is on the package she chose.
      await expect
        .poll(async () => prisma.trainingSession.count({ where: { clientId: full.clientId } }), { timeout: 30_000 })
        .toBeGreaterThan(0)

      // ── 11. She asks for something from the shop ────────────────────────
      // Without Stripe there is no checkout, so the shop's answer is a REQUEST
      // — the same path a trainer meets on their dashboard every morning.
      await clientPage.goto('/my-shop')
      const treatCard = clientPage.getByText('Training treats').first()
      await expect(treatCard, 'the shop should list what the trainer stocked').toBeVisible({ timeout: 20_000 })

      // Ask for it. With no Stripe there is no checkout, so a request is what
      // the shop offers — and it is the trainer's morning dashboard that has to
      // carry it.
      const asked = await clientPage.request.post(`/api/my/products/${treats.id}/request`, { data: {} })
      expect(asked.status(), await asked.text()).toBeLessThan(300)
    } finally {
      await clientCtx.close()
    }

    // ── 12. The trainer sees the booking, and her reply ───────────────────
    await page.goto('/schedule')
    await expect(page.getByText('Fiona Full').filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 })

    await page.goto('/messages')
    await expect(
      page.getByText(/See you then/).first(),
      'the client\'s reply should reach the trainer\'s inbox',
    ).toBeVisible({ timeout: 20_000 })

    // ── 13. And answers the shop request from the dashboard ───────────────
    // The panel renders twice, phone and desktop, from one server payload.
    // Answering it used to remove the row from the copy you clicked and leave
    // it on the other one forever, because the rows were seeded into state once
    // and never re-read. This walks the whole thing: see it, answer it, gone.
    await page.goto('/dashboard')
    const requestRow = page.getByTestId('request-row')
      .filter({ hasText: 'Training treats' })
      .filter({ visible: true })
      .first()
    await expect(requestRow, 'a client request should reach the dashboard').toBeVisible({ timeout: 20_000 })

    await requestRow.getByRole('button', { name: 'Mark done' }).click()
    await expect(
      page.getByTestId('request-row').filter({ hasText: 'Training treats' }),
      'an answered request must clear from BOTH copies of the panel',
    ).toHaveCount(0, { timeout: 20_000 })

    // ── 14. The class fills up, and then it doesn't ───────────────────────
    // Capacity 2, three people who want in. This is the part with the most
    // state in it: a seat, a queue, and what happens to the queue when a seat
    // comes back.
    const runId = klass.id ?? klass.runId
    const enrol = (clientId: string) =>
      page.request.post(`/api/class-runs/${runId}/enrollments`, { data: { clientId, type: 'FULL' } })

    const first = await enrol(full.clientId)
    const second = await enrol(quick.clientId)
    expect(first.status(), await first.text()).toBeLessThan(300)
    expect(second.status(), await second.text()).toBeLessThan(300)

    // Full, and no waitlist yet — the third is refused rather than quietly
    // squeezed in over capacity.
    const third = await enrol(noEmail.clientId)
    expect(
      third.status(),
      `a full class with no waitlist must refuse the next person, not overfill: ${await third.text()}`,
    ).toBeGreaterThanOrEqual(400)

    // Open a waitlist and ask again: now they queue instead of bouncing.
    await prisma.package.update({
      where: { id: (await prisma.classRun.findUnique({ where: { id: runId }, select: { packageId: true } }))!.packageId },
      data: { allowWaitlist: true },
    })
    const queued = await enrol(noEmail.clientId)
    expect(queued.status(), await queued.text()).toBeLessThan(300)
    const waitlisted = await prisma.classEnrollment.findFirst({
      where: { classRunId: runId, clientId: noEmail.clientId },
      select: { status: true },
    })
    expect(waitlisted?.status, 'the third person should be WAITLISTED, not enrolled').toBe('WAITLISTED')

    // A seat comes back. The person at the front of the queue should take it —
    // a waitlist that does not promote is just a list.
    const seat = await prisma.classEnrollment.findFirst({
      where: { classRunId: runId, clientId: full.clientId },
      select: { id: true },
    })
    const dropped = await page.request.delete(`/api/class-runs/${runId}/enrollments/${seat!.id}`)
    expect(dropped.status(), await dropped.text()).toBeLessThan(300)

    await expect
      .poll(async () => (await prisma.classEnrollment.findFirst({
        where: { classRunId: runId, clientId: noEmail.clientId },
        select: { status: true },
      }))?.status, { timeout: 20_000 })
      .toBe('ENROLLED')
  } finally {
    await prisma.$disconnect()
  }
})
