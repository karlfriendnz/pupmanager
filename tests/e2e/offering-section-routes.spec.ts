import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Casual classes and doggy daycare are ClassRuns under the hood, but each has
// its own detail route so the nav highlights the right section and the page
// never depends on the group-classes route or add-on. Also covers the package
// cover image, which now lives on the Package itself (1:1 offerings included).

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

test.use({ viewport: { width: 1280, height: 900 } })

test.describe('offering sections keep their own detail routes', () => {
  for (const section of [
    { path: '/casual-classes', back: 'Casual Classes', label: 'casual class' },
    { path: '/doggy-daycare', back: 'Doggy Daycare', label: 'daycare day-part' },
  ]) {
    test(`a ${section.label} run opens under ${section.path} with an in-section back link`, async ({ page }) => {
      const prisma = await makePrisma()
      const cleanup: Array<() => Promise<unknown>> = []
      try {
        const owner = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
        const trainer = await prisma.trainerProfile.findFirst({ where: { userId: owner!.id }, select: { id: true } })

        const name = `E2E ${section.back} Run`
        const pkg = await prisma.package.create({
          data: { trainerId: trainer!.id, name: `${name} Package`, sessionCount: 2, weeksBetween: 1, isGroup: true, allowDropIn: true },
        })
        cleanup.push(() => prisma.package.delete({ where: { id: pkg.id } }).catch(() => {}))
        const run = await prisma.classRun.create({
          data: { trainerId: trainer!.id, packageId: pkg.id, name, startDate: new Date(Date.now() + 7 * 864e5), status: 'SCHEDULED' },
        })
        cleanup.push(() => prisma.classRun.delete({ where: { id: run.id } }).catch(() => {}))

        await login(page, SEED.owner.email, SEED.owner.password)
        await page.goto(`${section.path}/${run.id}`)

        // The run's own detail screen, reached without touching /classes.
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 })
        // Back goes to this section's list, not the group-classes one.
        const back = page.getByRole('link', { name: section.back }).first()
        await expect(back).toBeVisible()
        await back.click()
        await expect(page).toHaveURL(new RegExp(`${section.path}$`))
      } finally {
        for (const fn of cleanup.reverse()) await fn()
        await prisma.$disconnect()
      }
    })
  }

  // The cover image used to live only on the class run, so a 1:1 package had
  // nowhere to put one.
  test('a 1:1 package carries its own cover image through create and edit', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const cover = 'https://example.com/e2e-cover.jpg'
      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Covered 1:1', sessionCount: 2, weeksBetween: 1, durationMins: 60, imageUrl: cover },
      })
      expect(res.status(), await res.text()).toBe(201)
      const b = await res.json()
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      expect((await prisma.package.findUnique({ where: { id: b.id }, select: { imageUrl: true } }))?.imageUrl).toBe(cover)

      // It renders on the package detail page…
      await page.goto(`/packages/${b.id}`)
      await expect(page.locator(`img[src="${cover}"]`).first()).toBeVisible({ timeout: 15_000 })

      // …and editing swaps it rather than dropping it.
      const next = 'https://example.com/e2e-cover-2.jpg'
      const patch = await page.request.patch(`/api/packages/${b.id}`, { data: { imageUrl: next } })
      expect(patch.status(), await patch.text()).toBe(200)
      expect((await prisma.package.findUnique({ where: { id: b.id }, select: { imageUrl: true } }))?.imageUrl).toBe(next)
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
