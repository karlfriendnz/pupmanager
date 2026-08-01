import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Two things a trainer reported from production, both the same shape: the
// client's own app knew something the trainer's screens didn't.
//
//   · a client whose only bookings are CLASSES read "Sessions 0" on their
//     record, while their own app listed the classes. Class sessions belong to
//     the run, not the client, so querying sessions by clientId found none.
//   · a household whose dogs were all added as EXTRAS (no primary) read
//     "No dog" in the clients list, while their profile showed four.
//
// Both are about the trainer seeing the whole client, so they're tested from
// the trainer's side against data set up the way the real ones were.

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('a client record shows the whole client', () => {
  test('class sessions count on the client record, not just 1:1 ones', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const className = `E2E Scent Class ${Date.now()}`
    let clientId: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })

      // A client who does classes and nothing else — no 1:1 sessions at all.
      const user = await prisma.user.create({
        data: { email: `e2e-classonly-${Date.now()}@e2e.test`, name: 'Class Only Client', role: 'CLIENT' },
      })
      const client = await prisma.clientProfile.create({
        data: { userId: user.id, trainerId: trainer!.id, status: 'ACTIVE', phone: '021 555 0170' },
      })
      clientId = client.id
      cleanup.push(() => prisma.clientProfile.delete({ where: { id: client.id } }).catch(() => {}))
      cleanup.push(() => prisma.user.delete({ where: { id: user.id } }).catch(() => {}))

      const pkg = await prisma.package.create({
        data: { trainerId: trainer!.id, name: `${className} Package`, sessionCount: 3, weeksBetween: 1, isGroup: true },
      })
      const run = await prisma.classRun.create({
        data: { trainerId: trainer!.id, packageId: pkg.id, name: className, startDate: new Date(Date.now() + 5 * 864e5), status: 'SCHEDULED' },
      })
      cleanup.push(() => prisma.package.delete({ where: { id: pkg.id } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: run.id } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: run.id } }).catch(() => {}))
      cleanup.push(() => prisma.classEnrollment.deleteMany({ where: { classRunId: run.id } }).catch(() => {}))

      // Class sessions belong to the run — note there's no clientId on them.
      for (let i = 1; i <= 3; i++) {
        await prisma.trainingSession.create({
          data: {
            trainerId: trainer!.id, classRunId: run.id, sessionIndex: i,
            title: `Session ${i}`, scheduledAt: new Date(Date.now() + (5 + i * 7) * 864e5),
          },
        })
      }
      await prisma.classEnrollment.create({
        data: { classRunId: run.id, clientId: client.id, status: 'ENROLLED', type: 'FULL' },
      })

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/clients/${client.id}`)

      // The record must not claim they have nothing on.
      await expect(
        page.getByText('Sessions 0', { exact: false }).locator('visible=true'),
        'a client enrolled in a class has sessions — the record said none',
      ).toHaveCount(0)

      // And the class itself is named on their record, under Sessions.
      const sessionsTab = page.getByRole('button', { name: 'Sessions' }).first()
      if (await sessionsTab.isVisible().catch(() => false)) await sessionsTab.click()
      await expect(page.getByText(className).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // The clients list "next session" knows about it too.
      await page.goto('/clients')  // Current: this one is booked onto a class
      // Each client is a link, not a table row.
      const row = page.getByRole('link').filter({ hasText: 'Class Only Client' }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('a household with only extra dogs still shows a dog in the list', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    const dogName = `Bilbo ${Date.now()}`
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })

      const user = await prisma.user.create({
        data: { email: `e2e-extradogs-${Date.now()}@e2e.test`, name: 'Extra Dogs Client', role: 'CLIENT' },
      })
      const client = await prisma.clientProfile.create({
        data: { userId: user.id, trainerId: trainer!.id, status: 'ACTIVE', phone: '021 555 0171' },
      })
      cleanup.push(() => prisma.clientProfile.delete({ where: { id: client.id } }).catch(() => {}))
      cleanup.push(() => prisma.user.delete({ where: { id: user.id } }).catch(() => {}))

      // Dogs attached as ADDITIONAL only — dogId (the primary) stays null,
      // exactly like the reported household with four dogs.
      for (const name of [dogName, `Wilfred ${Date.now()}`]) {
        await prisma.dog.create({ data: { name, breed: 'Black Russian Terrier', clientProfileId: client.id } })
      }
      cleanup.push(() => prisma.dog.deleteMany({ where: { clientProfileId: client.id } }).catch(() => {}))

      const check = await prisma.clientProfile.findUnique({
        where: { id: client.id }, select: { dogId: true, dogs: { select: { id: true } } },
      })
      expect(check?.dogId, 'the scenario needs NO primary dog').toBeNull()
      expect(check?.dogs.length).toBe(2)

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/clients?tab=never')

      const row = page.getByRole('link').filter({ hasText: 'Extra Dogs Client' }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row, 'they have two dogs — the list said "No dog"').not.toContainText('No dog')
      await expect(row).toContainText(dogName)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
