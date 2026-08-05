import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// /automations — every automation this business has, on one screen.
//
// The builder mounts in FIVE places, so until now a trainer could only see what
// they had automated by opening every offering one at a time (Karl: "is there a
// page somewhere where we can see all the automations?").
//
// What this proves, against a real database:
//   • a flow built on a class turns up on the page, described in the builder's
//     own words;
//   • a flow with every step switched off says so — that state is invisible
//     from the offering page it was built on;
//   • a step the engine will skip is flagged with the engine's own reason;
//   • the row is a WAY IN: it links to the editor's existing home.
//
// Everything is created and torn down by the test itself, so global-setup.ts
// and every other spec's counts are untouched.

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

test.use({ viewport: { width: 1280, height: 900 } })

test.describe('the automations index', () => {
  test('shows every flow, flags the off and the misconfigured, and links to the editor', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const makeClass = async (name: string): Promise<string> => {
        const res = await page.request.post('/api/packages', {
          data: {
            name, sessionCount: 2, weeksBetween: 1, durationMins: 60,
            isGroup: true, capacity: 8, startAt: inDays(12).toISOString(),
          },
        })
        expect(res.status(), await res.text()).toBe(201)
        const b = await res.json()
        cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
        cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
        cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))
        return b.classRunId as string
      }

      const liveRun = await makeClass('E2E Automations Live')
      const offRun = await makeClass('E2E Automations Switched Off')

      const addStep = async (runId: string, body: Record<string, unknown>) => {
        const res = await page.request.post(`/api/trainer/class-runs/${runId}/comms-flow`, { data: body })
        expect(res.status(), await res.text()).toBe(201)
        return (await res.json()).id as string
      }

      // A working reminder…
      await addStep(liveRun, {
        direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH'],
        audience: 'ENROLLED', customClientIds: [], important: false, enabled: true,
        title: 'E2E See you tomorrow', body: 'Reminder from us.',
      })
      // …and a FORM step with no form on the end of it, which the engine skips.
      await addStep(liveRun, {
        kind: 'FORM', direction: 'BEFORE_SESSION', offsetMinutes: 0, channels: ['PUSH'],
        audience: 'ENROLLED', customClientIds: [], important: false, enabled: true,
        title: null, body: null, payload: {},
      })
      // A whole flow the trainer switched off — indistinguishable from a working
      // one on the class page it was built on.
      await addStep(offRun, {
        direction: 'BEFORE_SESSION', offsetMinutes: 60, channels: ['PUSH'],
        audience: 'ENROLLED', customClientIds: [], important: false, enabled: false,
        title: 'E2E Paused reminder', body: 'Nobody gets this.',
      })

      await page.goto('/automations')
      await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()

      // Both flows are listed, under the Group classes heading.
      await expect(page.getByText('E2E Automations Live')).toBeVisible()
      await expect(page.getByText('E2E Automations Switched Off')).toBeVisible()
      // exact, so the left menu's own "Group Classes" link isn't what matches.
      await expect(page.getByText('Group classes', { exact: true })).toBeVisible()

      // Described in the builder's own words, not a second phrasing.
      await expect(page.getByText('Send push: E2E See you tomorrow')).toBeVisible()

      // The flow whose every step is off says so.
      const offRow = page.locator('a', { hasText: 'E2E Automations Switched Off' })
      await expect(offRow.getByText('Off', { exact: true })).toBeVisible()

      // The step the engine will skip carries the engine's own reason.
      await expect(page.getByText('No form chosen')).toBeVisible()

      // The row is a way IN — to the editor where it already lives.
      const liveRow = page.locator('a', { hasText: 'E2E Automations Live' }).first()
      await expect(liveRow).toHaveAttribute('href', `/classes/${liveRun}`)
      await liveRow.click()
      await page.waitForURL(`**/classes/${liveRun}`)
    } finally {
      for (const undo of cleanup.reverse()) await undo()
      await prisma.$disconnect()
    }
  })

  test('a signed-out visitor is bounced to login', async ({ page }) => {
    await page.goto('/automations')
    await expect(page).toHaveURL(/\/login/)
  })
})
