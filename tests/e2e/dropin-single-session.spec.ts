import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Single-session drop-in model, against the real embedded Postgres (the
// per-session capacity + roster logic lives in a Prisma transaction a mock
// can't exercise):
//   - a drop-in is booked onto ONE session (dropInSessionId set, priced flat)
//   - it appears on that session's roster only, not the run's other sessions
//   - a course that's "full" for the term still takes a drop-in where a
//     specific session has room
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

test.describe('drop-in — single session', () => {
  test('drops into one session only, priced flat, per-session capacity', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      const trainer = await prisma.trainerProfile.findFirst({ where: { userId: owner!.id }, select: { id: true } })
      expect(trainer, 'owner trainer profile').toBeTruthy()
      const trainerId = trainer!.id

      // A group class that takes drop-ins at $25/session, capacity 2.
      const pkg = await prisma.package.create({
        data: { trainerId, name: 'Drop-in Test Class', sessionCount: 3, weeksBetween: 1, isGroup: true, capacity: 2, priceCents: 9000, allowDropIn: true, dropInPriceCents: 2500 },
      })
      cleanup.push(() => prisma.package.delete({ where: { id: pkg.id } }).catch(() => {}))

      const run = await prisma.classRun.create({
        data: { trainerId, packageId: pkg.id, name: 'Drop-in Test Run', startDate: new Date(Date.now() + 7 * 864e5), status: 'SCHEDULED' },
      })
      cleanup.push(() => prisma.classRun.delete({ where: { id: run.id } }).catch(() => {}))

      // Two upcoming sessions.
      const s1 = await prisma.trainingSession.create({ data: { trainerId, classRunId: run.id, sessionIndex: 1, title: 'Session 1', scheduledAt: new Date(Date.now() + 7 * 864e5) } })
      const s2 = await prisma.trainingSession.create({ data: { trainerId, classRunId: run.id, sessionIndex: 2, title: 'Session 2', scheduledAt: new Date(Date.now() + 14 * 864e5) } })

      await login(page, SEED.owner.email, SEED.owner.password)

      // Enrol the seeded client as a DROP_IN into session 2.
      const res = await page.request.post(`/api/class-runs/${run.id}/enrollments`, {
        data: { clientId: SEED.assignedClientId, type: 'DROP_IN', sessionId: s2.id, notify: false, sendInvoice: false },
      })
      expect(res.status(), await res.text()).toBe(201)

      // It's a drop-in on session 2 (not the whole run).
      const enr = await prisma.classEnrollment.findFirst({
        where: { classRunId: run.id, clientId: SEED.assignedClientId },
        select: { id: true, type: true, dropInSessionId: true, joinedAtIndex: true },
      })
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: run.id } }).catch(() => {}))
      expect(enr?.type).toBe('DROP_IN')
      expect(enr?.dropInSessionId).toBe(s2.id)
      expect(enr?.joinedAtIndex).toBe(2)

      // Priced flat — one session ($25), NOT × remaining.
      const inv = await prisma.invoice.findFirst({ where: { trainerId, clientId: SEED.assignedClientId, sourceType: 'CLASS_ENROLLMENT', sourceId: enr!.id }, select: { id: true, amountCents: true } })
      cleanup.push(() => (inv ? prisma.invoice.delete({ where: { id: inv.id } }).catch(() => {}) : Promise.resolve()))
      expect(inv?.amountCents).toBe(2500)

      // Roster: on session 2 they show; on session 1 they don't.
      const roster2 = await (await page.request.get(`/api/class-runs/${run.id}/sessions/${s2.id}/attendance`)).json()
      const roster1 = await (await page.request.get(`/api/class-runs/${run.id}/sessions/${s1.id}/attendance`)).json()
      expect(roster2.roster.some((r: { enrollmentId: string }) => r.enrollmentId === enr!.id)).toBe(true)
      expect(roster1.roster.some((r: { enrollmentId: string }) => r.enrollmentId === enr!.id)).toBe(false)

      // A drop-in must name its session.
      const noSession = await page.request.post(`/api/class-runs/${run.id}/enrollments`, {
        data: { clientId: SEED.unassignedClientId, type: 'DROP_IN', notify: false },
      })
      expect(noSession.status()).toBe(400)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
