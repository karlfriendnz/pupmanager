import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The reported bug: deleting a class "didn't delete the sessions or the class".
// The cause was that a class with ANY enrolment took a soft-cancel branch and
// still returned 200 ok — so the UI navigated away while the class and every
// one of its sessions stayed put. This drives the real screen against the real
// DB, with an enrolled client, because that's the only case that failed.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

function db() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

test('deleting a class with an enrolled client removes the class AND its sessions', async ({ page }) => {
  const prisma = db()
  let runId = ''
  try {
    const trainer = await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } })
    const pkg = await prisma.package.findFirst({ where: { trainerId: trainer!.id } })

    const run = await prisma.classRun.create({
      data: {
        trainerId: trainer!.id,
        packageId: pkg!.id,
        name: 'Delete Me Class',
        startDate: new Date('2026-09-01T10:00:00Z'),
        sessions: {
          create: [
            { trainerId: trainer!.id, title: 'Delete Me Class — session 1', scheduledAt: new Date('2026-09-01T10:00:00Z'), sessionIndex: 1 },
            { trainerId: trainer!.id, title: 'Delete Me Class — session 2', scheduledAt: new Date('2026-09-08T10:00:00Z'), sessionIndex: 2 },
          ],
        },
        // The enrolment is the whole point — without one, the old code deleted fine.
        enrollments: { create: [{ clientId: SEED.assignedClientId }] },
      },
      include: { sessions: true },
    })
    runId = run.id
    expect(run.sessions).toHaveLength(2)

    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/classes/${run.id}`)
    await expect(page.getByText('Delete Me Class').first()).toBeVisible()

    page.once('dialog', d => d.accept()) // in case the UI confirms
    await page.getByRole('button', { name: /Delete/i }).first().click()
    const confirm = page.getByRole('button', { name: /^(Confirm|Delete class|Yes, delete)/i }).first()
    if (await confirm.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/class-runs/') && r.request().method() === 'DELETE'),
        confirm.click(),
      ])
    }

    // Gone from the list the trainer is looking at...
    await page.waitForURL('**/classes', { timeout: 15_000 })
    await expect(page.getByText('Delete Me Class')).toHaveCount(0)

    // ...and actually gone from the database, sessions included. A soft-cancel
    // (status CANCELLED, sessions still on the schedule) fails right here.
    const after = await prisma.classRun.findUnique({ where: { id: run.id } })
    expect(after).toBeNull()
    const orphanSessions = await prisma.trainingSession.count({ where: { classRunId: run.id } })
    expect(orphanSessions).toBe(0)
  } finally {
    if (runId) await prisma.classRun.deleteMany({ where: { id: runId } }).catch(() => {})
    await prisma.$disconnect()
  }
})
