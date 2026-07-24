import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Automated communication flows: a trainer builds a timed-message flow on a
// class, it persists, shows on the class page, and can be saved + reused as a
// template on another class. Plus the guard: an unauthenticated caller can't
// create a step.

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

const inDays = (n: number) => new Date(Date.now() + n * 864e5)

// Desktop layout so the full-width Messages section renders without the phone tab.
test.use({ viewport: { width: 1280, height: 900 } })

test.describe('automated communication flows', () => {
  test('a trainer builds a flow; it persists, renders, and reuses as a template', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const makeClass = async (name: string): Promise<string> => {
        const res = await page.request.post('/api/packages', {
          data: { name, sessionCount: 3, weeksBetween: 1, durationMins: 60, isGroup: true, capacity: 8, startAt: inDays(10).toISOString() },
        })
        expect(res.status(), await res.text()).toBe(201)
        const b = await res.json()
        cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
        cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
        cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))
        return b.classRunId as string
      }
      const runA = await makeClass('E2E Flow Class A')
      const runB = await makeClass('E2E Flow Class B')

      // Build a step on run A.
      const create = await page.request.post(`/api/trainer/class-runs/${runA}/comms-flow`, {
        data: {
          direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH', 'IN_APP'],
          audience: 'ENROLLED', important: true, title: 'E2E Bring treats',
          body: 'Hi {{name}}, bring treats for {{dog}}.', enabled: true,
        },
      })
      expect(create.status(), await create.text()).toBe(201)
      expect(await prisma.commsFlowStep.count({ where: { classRunId: runA } })).toBe(1)

      // It renders on the class page (desktop shows the Messages section).
      await page.goto(`/classes/${runA}`)
      await expect(page.getByText('E2E Bring treats')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('1 day before', { exact: false })).toBeVisible()

      // Save the flow as a template…
      const save = await page.request.post('/api/trainer/comms-flow-templates', {
        data: { name: 'E2E Standard Reminders', runId: runA },
      })
      expect(save.status(), await save.text()).toBe(201)
      const tmpl = await save.json()
      cleanup.push(() => prisma.commsFlowTemplate.delete({ where: { id: tmpl.id } }).catch(() => {}))

      // …and apply it to run B in one call.
      const apply = await page.request.post(`/api/trainer/class-runs/${runB}/comms-flow/apply-template`, {
        data: { templateId: tmpl.id },
      })
      expect(apply.status(), await apply.text()).toBe(201)

      const copied = await prisma.commsFlowStep.findFirst({ where: { classRunId: runB } })
      expect(copied?.title).toBe('E2E Bring treats')
      expect(copied?.important).toBe(true)
      expect(copied?.channels).toEqual(['PUSH', 'IN_APP'])
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  test('an unauthenticated caller cannot create a flow step', async ({ page, browser }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Guard Class', sessionCount: 2, weeksBetween: 1, durationMins: 60, isGroup: true, startAt: inDays(10).toISOString() },
      })
      const b = await res.json()
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      const anon = await browser.newContext()
      const guard = await anon.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, { data: { title: 'x' } })
      expect([401, 403]).toContain(guard.status())
      expect(await prisma.commsFlowStep.count({ where: { classRunId: b.classRunId } })).toBe(0)
      await anon.close()
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
