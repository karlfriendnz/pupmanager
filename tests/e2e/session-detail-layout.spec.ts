import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

function db() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

// The session detail screen, at phone width.
//
// It used to be a stack of floating cards — a 340px dog-photo hero, a card per
// empty section, three coloured action tiles, and two links hidden behind a
// "…" menu in the header. 1375px of scrolling for a session with no notes, no
// time logged and no attachments. These tests pin the shape it was rebuilt
// into: one block of facts, one strip of actions, and every empty section
// costing a single row.
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

/** An ad-hoc session on Business A's assigned client — no notes, no time, no media. */
async function createSession(page: Page, title = 'E2E Layout Session'): Promise<string> {
  const res = await page.request.post('/api/schedule/sessions', {
    data: {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMins: 45,
      title,
      location: 'E2E Park',
      attendees: [{ clientId: SEED.assignedClientId }],
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  const { id } = await res.json() as { id: string }
  expect(id).toBeTruthy()
  return id
}

test.use({ viewport: { width: 390, height: 844 } })

test('an empty session fits on a phone — one facts block, collapsed sections, no hero', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page)
  await page.goto(`/sessions/${id}`)

  // The facts are a list: when (with duration) and where.
  await expect(page.getByText('45 min', { exact: false })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('E2E Park')).toBeVisible()

  // Every empty section costs ONE row that says what's in it — no card, no
  // heading, no "nothing here yet" paragraph inside a bordered box.
  await expect(page.getByText('No photos or videos')).toBeVisible()
  await expect(page.getByText('None set')).toBeVisible()
  await expect(page.getByText('Nothing logged')).toBeVisible()

  // Collapsed means collapsed: the uploader only exists once the row is opened.
  const addPhoto = page.getByRole('button', { name: 'Add photo' })
  await expect(addPhoto).toBeHidden()
  await page.getByText('Photos & video', { exact: true }).click()
  await expect(addPhoto).toBeVisible()
  await page.getByText('Photos & video', { exact: true }).click()

  // The whole screen, closed, has to stay in the same order of magnitude as a
  // couple of phone screens. It was 1375px before the rebuild; this guard trips
  // long before it could creep back there.
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(height).toBeLessThan(1200)
})

test('every action stays reachable on the page itself — nothing hides in a "…" menu', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Actions Session')
  await page.goto(`/sessions/${id}`)

  // The header's overflow menu is gone — its two items live on the page now.
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Preview report/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Delete session/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Client profile/ })).toBeVisible()

  // Complete and invoice are inline, and they still write through.
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Invoiced' })).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Invoiced' })).toBeVisible()
})

test('delete asks first, and only then deletes', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Delete Session')
  await page.goto(`/sessions/${id}`)

  // One tap must never destroy a session.
  await page.getByRole('button', { name: /Delete session/ }).click()
  const confirm = page.getByText('Delete this session?').locator('..')
  await expect(confirm).toBeVisible({ timeout: 20_000 })
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Delete this session?')).toHaveCount(0)
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(200)

  // Confirming does.
  await page.getByRole('button', { name: /Delete session/ }).click()
  await page.getByText('Delete this session?').locator('..')
    .getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL(url => !url.pathname.includes(`/sessions/${id}`), { timeout: 20_000 })
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(404)
})

test('another tenant cannot open the session', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Tenant Session')

  await page.context().clearCookies()
  await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(404)
})

test('the header states nothing the rows below it already say', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Quiet Header Session')
  await page.goto(`/sessions/${id}`)
  await expect(page.getByText('45 min', { exact: false })).toBeVisible({ timeout: 20_000 })

  // The lifecycle word is gone: it read "Upcoming" on almost every session, and
  // the Complete / Invoice cells directly beneath it already carry that state.
  await expect(page.getByText('Upcoming')).toHaveCount(0)

  // "In-person" had a row to itself and spent it stating the default. A real
  // place still shows — folded into the when-row, not given a row of its own.
  await expect(page.getByText('In-person')).toHaveCount(0)
  await expect(page.getByText('E2E Park')).toBeVisible()
  await expect(page.locator('svg.lucide-map-pin')).toHaveCount(0)
})

test('choosing a form is one row driven by the platform\'s own picker', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Form Picker Session')
  await page.goto(`/sessions/${id}`)

  const row = page.getByText('Write up this session')
  await expect(row).toBeVisible({ timeout: 20_000 })

  // A real native <select>, not a hand-built menu — so a phone gets the OS
  // picker and there is no panel of our own to bleed over the rows beneath.
  const select = page.locator('select[aria-label="Choose a form for this session"]')
  await expect(select).toHaveCount(1)

  // It IS the row: laid invisibly over the whole tap target, so the popup
  // anchors to a full-width row rather than bursting out of a small field.
  const box = (await select.boundingBox())!
  const label = (await row.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(label.width)
  expect(box.y).toBeLessThanOrEqual(label.y)
  expect(await select.evaluate(el => getComputedStyle(el).opacity)).toBe('0')

  // And nothing that reads as a dropped-in form field: no visible label above a
  // bordered box, and no horizontal overflow at 390.
  await expect(page.getByText('Choose a form for this session')).toHaveCount(0)
  const [scrollW, clientW] = await page.evaluate(() => [document.body.scrollWidth, document.body.clientWidth])
  expect(scrollW).toBe(clientW)
})

test('a group-class session opens its class screen instead of 404ing', async ({ page }) => {
  // Regression: the detail page filtered on `clientId: { not: null }` to hide
  // orphans, but a class session has clientId null BY DESIGN (attendance is
  // per-enrollee). That filter 404'd every class session in the app.
  const prisma = db()
  let runId = ''
  try {
    const trainer = await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } })
    const pkg = await prisma.package.findFirst({ where: { trainerId: trainer!.id } })
    const run = await prisma.classRun.create({
      data: {
        trainerId: trainer!.id,
        packageId: pkg!.id,
        name: 'E2E Redirect Class',
        startDate: new Date('2026-10-05T10:00:00Z'),
        sessions: {
          create: [{
            trainerId: trainer!.id,
            title: 'E2E Redirect Class — session 1',
            scheduledAt: new Date('2026-10-05T10:00:00Z'),
            sessionIndex: 1,
          }],
        },
      },
      include: { sessions: true },
    })
    runId = run.id
    const classSession = run.sessions[0]
    expect(classSession.clientId).toBeNull()

    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/sessions/${classSession.id}`)

    // Lands on the screen built for it — the one the schedule already links to.
    await page.waitForURL(`**/classes/${run.id}/sessions/${classSession.id}`, { timeout: 20_000 })

    // A different tenant still gets nothing.
    await page.context().clearCookies()
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    expect((await page.request.get(`/sessions/${classSession.id}`)).status()).toBe(404)
  } finally {
    if (runId) await prisma.classRun.deleteMany({ where: { id: runId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('a session whose client was deleted says so, rather than showing a bare 404', async ({ page }) => {
  const prisma = db()
  let sessionId = ''
  try {
    const trainer = await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } })
    // No client, no dog, no class run — what's left after a client is removed.
    const orphan = await prisma.trainingSession.create({
      data: {
        trainerId: trainer!.id,
        title: 'E2E Orphaned Session',
        scheduledAt: new Date('2026-10-12T10:00:00Z'),
        durationMins: 45,
      },
    })
    sessionId = orphan.id

    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.goto(`/sessions/${orphan.id}`)
    expect(res!.status()).toBe(200)
    await expect(page.getByText('This session has no client')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: /Back to the schedule/ })).toBeVisible()

    // Still tenant-scoped.
    await page.context().clearCookies()
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    expect((await page.request.get(`/sessions/${orphan.id}`)).status()).toBe(404)
  } finally {
    if (sessionId) await prisma.trainingSession.deleteMany({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})
