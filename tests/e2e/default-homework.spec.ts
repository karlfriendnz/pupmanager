import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Default homework on an offering:
//   • a trainer sets it up once, per session, from their library;
//   • it lists what it will suggest, and a row can be taken off again;
//   • and it never reaches across tenants — not the offering, not the library
//     item a default points at.
const LIB = SEED.library
const PKG = SEED.selfBookPackageId

function db() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test('a trainer sets an offering\'s default homework from their library, then takes it off', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  await page.goto(`/packages/${PKG}`)
  // The section strip is a tablist (role=tab), not a row of buttons.
  await page.getByRole('tab', { name: /Homework/ }).click()

  // Both buckets are offered: the "every session" one, and session 1 (this
  // offering runs a single session).
  await expect(page.getByText('Every session')).toBeVisible()
  await expect(page.getByText('Session 1', { exact: true })).toBeVisible()

  // Adding opens a FULL SCREEN library picker, not a dropdown.
  await page.getByRole('button', { name: 'Add homework' }).first().click()
  const picker = page.getByRole('dialog', { name: /Add homework/ })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: new RegExp(LIB.itemTitle) }).click()
  await picker.getByRole('button', { name: 'Close' }).click()

  // It's listed against the bucket it was added to, with where it lives.
  const row = page.getByText(LIB.itemTitle, { exact: true })
  await expect(row).toBeVisible()
  await expect(page.getByText(`${LIB.typeName} · ${LIB.themeName}`)).toBeVisible()

  // And it comes off again.
  await page.getByRole('button', { name: `Remove ${LIB.itemTitle}` }).click()
  await expect(row).toHaveCount(0)
})

test('the defaults of one business are invisible and unwritable to another', async ({ page }) => {
  // Business B signs in and goes after Business A's offering directly.
  await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

  const read = await page.request.get(`/api/trainer/packages/${PKG}/default-homework`)
  expect(read.status()).toBe(404)

  const write = await page.request.post(`/api/trainer/packages/${PKG}/default-homework`, {
    data: { sessionIndex: 1, title: 'Injected by a rival' },
  })
  expect(write.status()).toBe(404)
})

test('a default cannot point at another business\'s library item', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  // Business A owns the offering, but the library item belongs to Business B.
  // The id IS the task here, so an unresolvable one is refused outright.
  const res = await page.request.post(`/api/trainer/packages/${PKG}/default-homework`, {
    data: { sessionIndex: 1, libraryTaskId: LIB.businessBItemId },
  })
  expect(res.status()).toBe(404)
})

test('confirming the defaults on a session hands the client real homework, once', async ({ page }) => {
  // This one builds its own offering, booking and session so it can prove the
  // whole path, and tears them down again — the seeded rows other specs count
  // are left alone.
  const prisma = db()
  const client = await prisma.clientProfile.findUniqueOrThrow({
    where: { id: SEED.assignedClientId }, select: { trainerId: true },
  })
  const pkg = await prisma.package.create({
    data: { trainerId: client.trainerId, name: 'E2E Default Homework 1:1 Session', sessionCount: 2, weeksBetween: 1 },
  })
  const booking = await prisma.clientPackage.create({
    data: { packageId: pkg.id, clientId: SEED.assignedClientId, startDate: new Date('2026-08-01T00:00:00.000Z') },
  })
  // Two sessions, so "session 2" has to be worked out from its place in the series.
  const [, second] = await prisma.trainingSession.createManyAndReturn({
    data: [
      { trainerId: client.trainerId, clientId: SEED.assignedClientId, clientPackageId: booking.id, title: 'E2E DH one', scheduledAt: new Date('2026-08-01T02:00:00.000Z') },
      { trainerId: client.trainerId, clientId: SEED.assignedClientId, clientPackageId: booking.id, title: 'E2E DH two', scheduledAt: new Date('2026-08-08T02:00:00.000Z') },
    ],
  })

  try {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Set the default on session 2 only.
    const add = await page.request.post(`/api/trainer/packages/${pkg.id}/default-homework`, {
      data: { sessionIndex: 2, libraryTaskId: LIB.itemId },
    })
    expect(add.status()).toBe(201)

    // Session 2 suggests it; the text is read live from the library item.
    const suggested = await (await page.request.get(`/api/sessions/${second.id}/default-homework`)).json()
    expect(suggested.sessionIndex).toBe(2)
    expect(suggested.tasks).toHaveLength(1)
    expect(suggested.tasks[0].title).toBe(LIB.itemTitle)

    // One tap hands it over as ordinary homework, on the session's own day.
    const first = await page.request.post(`/api/sessions/${second.id}/default-homework`, { data: {} })
    expect(first.status()).toBe(201)
    expect((await first.json()).created).toBe(1)

    // Tapping again must not double it up.
    const again = await page.request.post(`/api/sessions/${second.id}/default-homework`, { data: {} })
    expect((await again.json()).created).toBe(0)

    const handed = await prisma.trainingTask.findMany({ where: { sessionId: second.id } })
    expect(handed).toHaveLength(1)
    // A snapshot with the library link kept only as provenance.
    expect(handed[0]).toMatchObject({ title: LIB.itemTitle, libraryTaskId: LIB.itemId, clientId: SEED.assignedClientId })
  } finally {
    await prisma.trainingTask.deleteMany({ where: { sessionId: second.id } })
    await prisma.trainingSession.deleteMany({ where: { clientPackageId: booking.id } })
    await prisma.clientPackage.delete({ where: { id: booking.id } })
    await prisma.package.delete({ where: { id: pkg.id } })
    await prisma.$disconnect()
  }
})

test('a session belonging to another business suggests nothing', async ({ page }) => {
  await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

  // An id that isn't theirs must not confirm which — it answers "nothing here".
  const res = await page.request.get('/api/sessions/e2enosuchsession00000000/default-homework')
  expect(res.status()).toBe(200)
  expect(await res.json()).toMatchObject({ packageId: null, tasks: [] })

  const write = await page.request.post('/api/sessions/e2enosuchsession00000000/default-homework', { data: {} })
  expect(write.status()).toBe(404)
})
