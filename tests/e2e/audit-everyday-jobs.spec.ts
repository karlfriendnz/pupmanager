/**
 * THE EVERYDAY JOBS.
 *
 * Karl, 2026-08-05, after a day of audits: *"did you realise you couldn't edit a
 * session date or cancel a session?"* No — because none of the audits did the
 * ordinary thing. They probed for leaks, round-tripped fields, chased money
 * through undo paths and asserted invariants over the whole codebase. Not one of
 * them opened a session and moved it to next Tuesday.
 *
 * So this is the boring list: the handful of jobs a trainer does every single
 * day. If one of these breaks, nothing else in the suite matters.
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const at = (daysFromNow: number, hour = 10) => {
  const d = new Date(Date.now() + daysFromNow * 864e5)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

test('a session can have its date changed, and can be cancelled', async ({ page }) => {
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let sessionId = ''
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    const client = await prisma.clientProfile.findFirstOrThrow({
      where: { trainerId: trainer.id },
      select: { id: true, dogId: true },
    })

    const session = await prisma.trainingSession.create({
      data: {
        trainerId: trainer.id,
        clientId: client.id,
        dogId: client.dogId,
        title: `Everyday job ${tag}`,
        scheduledAt: at(7),
        durationMins: 60,
        status: 'UPCOMING',
      },
    })
    sessionId = session.id

    // ── Move it to another day ────────────────────────────────────────────────
    const moved = at(9, 14)
    const patch = await page.request.patch(`/api/schedule/${session.id}`, {
      data: { scheduledAt: moved.toISOString() },
    })
    expect(patch.status(), await patch.text()).toBe(200)

    const after = await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(
      after.scheduledAt.toISOString(),
      'the session should now be on the day it was moved to',
    ).toBe(moved.toISOString())

    // ── Cancel it ─────────────────────────────────────────────────────────────
    // This route gained a step on 2026-08-05 (settling the receivable of an
    // emptied booking, audit T-12). If that step throws, the session goes and
    // the trainer sees a failure — so cancelling is asserted end to end.
    const cancelled = await page.request.delete(`/api/schedule/${session.id}`)
    expect(cancelled.status(), await cancelled.text()).toBe(200)

    const gone = await prisma.trainingSession.findUnique({ where: { id: session.id } })
    expect(gone, 'the cancelled session should be gone').toBeNull()
    sessionId = ''
  } finally {
    if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('the schedule screen opens a session and offers a way to change it', async ({ page }) => {
  // The API working is not the same as a trainer being able to do it. This is
  // the screen, not the route.
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let sessionId = ''
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    const client = await prisma.clientProfile.findFirstOrThrow({
      where: { trainerId: trainer.id },
      select: { id: true, dogId: true },
    })
    const title = `Screen job ${tag}`
    const session = await prisma.trainingSession.create({
      data: {
        trainerId: trainer.id, clientId: client.id, dogId: client.dogId,
        title, scheduledAt: at(3), durationMins: 60, status: 'UPCOMING',
      },
    })
    sessionId = session.id

    await page.goto(`/sessions/${session.id}`)
    // It opens at all, and it is the right session.
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })

    // And there is a way to change or cancel it on the screen — whatever it is
    // called, a trainer has to be able to find it.
    const change = page.getByRole('button', { name: /edit|change|reschedul|move/i })
    const remove = page.getByRole('button', { name: /cancel|delete|remove/i })
    expect(
      (await change.count()) + (await remove.count()),
      'a session screen with no way to edit or cancel it is a dead end',
    ).toBeGreaterThan(0)
  } finally {
    if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})
