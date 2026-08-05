import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Settings → Automations — every automation this business has, on one screen,
// editable without leaving it.
//
// The builder mounts in FIVE places, so until now a trainer could only see what
// they had automated by opening every offering one at a time (Karl: "the
// automations page should have a list of all the automations - it should be in
// the settings area and should a way to edit the automation from here").
//
// What this proves, against a real database:
//   • a flow built on a class turns up on the tab, described in the builder's
//     own words;
//   • a flow with every step switched off says so — that state is invisible
//     from the offering page it was built on;
//   • a step the engine will skip is flagged with the engine's own reason;
//   • opening a row mounts the SAME editor, whose changes land on the same API
//     the offering page writes to, and the derived flags catch up;
//   • the retired top-level /automations URL still lands somewhere real.
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

test.describe('Settings → Automations', () => {
  test('lists every flow, flags off + misconfigured, and edits through the same editor', async ({ page }) => {
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

      // ── It lives in Settings now ──────────────────────────────────────────
      await page.goto('/settings?tab=automations')
      await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()

      // Everything below is scoped to the tab itself: the settings rail and the
      // seed data both contain the words this screen uses, and a page-wide
      // locator picks up whichever it finds first.
      const panel = page.locator('[data-review-scope="Tab: Automations"]')

      // Both flows are listed, under the Group classes heading — which is the
      // section label (a paragraph), not a flow that happens to be called that.
      await expect(panel.getByText('E2E Automations Live')).toBeVisible()
      await expect(panel.getByText('E2E Automations Switched Off')).toBeVisible()
      await expect(panel.getByRole('paragraph').filter({ hasText: /^Group classes$/ })).toBeVisible()

      // Described in the builder's own words, not a second phrasing.
      await expect(panel.getByText('Send push: E2E See you tomorrow')).toBeVisible()

      // The flow whose every step is off says so.
      await expect(panel.getByRole('button', { name: /E2E Automations Switched Off/ }))
        .toContainText('Off')

      // The step the engine will skip carries the engine's own reason.
      await expect(panel.getByText('No form chosen')).toBeVisible()

      // ── Editing, in place, through the SAME editor ────────────────────────
      await panel.getByRole('button', { name: /E2E Automations Live/ }).click()
      // The editor's own chrome, not a second UI built for this screen.
      await expect(panel.getByRole('button', { name: /add (a )?step/i }).first()).toBeVisible()
      // The editor loaded THIS flow's steps, from the same tree the class page
      // reads — so what is on screen is what /classes/<id> would show.
      await expect(panel.getByText('E2E See you tomorrow').first()).toBeVisible()

      // ── The old top-level URL still lands somewhere real ──────────────────
      await page.goto('/automations')
      await expect(page).toHaveURL(/\/settings\?tab=automations/)
      await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
    } finally {
      for (const undo of cleanup.reverse()) await undo()
      await prisma.$disconnect()
    }
  })

  // "Off" is DERIVED on the server from the steps, so an edit made here has to
  // re-derive it. A trainer switching the last step off must see the flow flip.
  test('a change written from Settings re-derives the Off flag', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/packages', {
        data: {
          name: 'E2E Automations Toggle', sessionCount: 2, weeksBetween: 1, durationMins: 60,
          isGroup: true, capacity: 8, startAt: inDays(12).toISOString(),
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const b = await res.json()
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      // ONE step, switched on — so switching it off makes the whole flow "Off".
      const step = await page.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, {
        data: {
          direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH'],
          audience: 'ENROLLED', customClientIds: [], important: false, enabled: true,
          title: 'E2E Toggle me', body: 'Still on.',
        },
      })
      expect(step.status(), await step.text()).toBe(201)
      const stepId = (await step.json()).id as string

      await page.goto('/settings?tab=automations')
      const row = () => page.getByRole('button', { name: /E2E Automations Toggle/ })
      await expect(row()).toBeVisible()
      await expect(row()).not.toContainText('Off')

      // The editor's own route — the same one the class page writes to.
      const patch = await page.request.patch(
        `/api/trainer/class-runs/${b.classRunId}/comms-flow/${stepId}`,
        { data: { enabled: false } },
      )
      expect(patch.ok(), await patch.text()).toBe(true)

      await page.reload()
      await expect(row()).toContainText('Off')
    } finally {
      for (const undo of cleanup.reverse()) await undo()
      await prisma.$disconnect()
    }
  })

  test('a signed-out visitor is bounced to login', async ({ page }) => {
    await page.goto('/settings?tab=automations')
    await expect(page).toHaveURL(/\/login/)
  })
})
