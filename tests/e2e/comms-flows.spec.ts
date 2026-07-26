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

      // Build a step on run A. In-app is staff-only now, so asking for it on a
      // client-facing step must come back without it.
      const create = await page.request.post(`/api/trainer/class-runs/${runA}/comms-flow`, {
        data: {
          direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH', 'IN_APP'],
          audience: 'ENROLLED', important: true, title: 'E2E Bring treats',
          body: 'Hi {{name}}, bring treats for {{dog}}.', enabled: true,
        },
      })
      expect(create.status(), await create.text()).toBe(201)
      expect((await create.json()).channels).toEqual(['PUSH'])
      expect(await prisma.commsFlowStep.count({ where: { classRunId: runA } })).toBe(1)

      // It renders on the class page, under its own "Reminders & messages" tab.
      await page.goto(`/classes/${runA}`)
      await page.getByRole('button', { name: 'Reminders & messages' }).click()
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
      expect(copied?.channels).toEqual(['PUSH'])
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // An EMAIL step is authored with the rich editor into its own emailBody; the
  // short plain body stays for push/in-app. Both must persist and travel with a
  // saved template.
  test('an email step keeps its own rich body, through save-as-template', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Email Flow Class', sessionCount: 2, weeksBetween: 1, durationMins: 60, isGroup: true, startAt: inDays(10).toISOString() },
      })
      expect(res.status(), await res.text()).toBe(201)
      const b = await res.json()
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      const emailBody = '<p>Hi <strong>{{name}}</strong>, here is what to bring.</p><ul><li>Treats</li></ul>'
      const create = await page.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, {
        data: {
          direction: 'BEFORE_SESSION', offsetMinutes: 60, channels: ['EMAIL', 'PUSH'],
          audience: 'ENROLLED', important: false, title: 'E2E What to bring',
          body: 'Bring treats for {{dog}}.', emailBody, enabled: true,
        },
      })
      expect(create.status(), await create.text()).toBe(201)

      const step = await prisma.commsFlowStep.findFirst({ where: { classRunId: b.classRunId } })
      expect(step?.emailBody).toBe(emailBody)
      expect(step?.body).toBe('Bring treats for {{dog}}.') // push copy untouched

      // The rich body survives being saved as a template.
      const save = await page.request.post('/api/trainer/comms-flow-templates', {
        data: { name: 'E2E Email Template', runId: b.classRunId },
      })
      expect(save.status(), await save.text()).toBe(201)
      const tmpl = await save.json()
      cleanup.push(() => prisma.commsFlowTemplate.delete({ where: { id: tmpl.id } }).catch(() => {}))
      const savedTmpl = await prisma.commsFlowTemplate.findUnique({ where: { id: tmpl.id }, select: { steps: true } })
      const tmplSteps = savedTmpl?.steps as { emailBody?: string }[]
      expect(tmplSteps[0]?.emailBody).toBe(emailBody)

      // …and lands intact on the next class it's applied to.
      const res2 = await page.request.post('/api/packages', {
        data: { name: 'E2E Email Flow Class 2', sessionCount: 2, weeksBetween: 1, durationMins: 60, isGroup: true, startAt: inDays(12).toISOString() },
      })
      const b2 = await res2.json()
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b2.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b2.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b2.id } }).catch(() => {}))
      const apply = await page.request.post(`/api/trainer/class-runs/${b2.classRunId}/comms-flow/apply-template`, {
        data: { templateId: tmpl.id },
      })
      expect(apply.status(), await apply.text()).toBe(201)
      const applied = await prisma.commsFlowStep.findFirst({ where: { classRunId: b2.classRunId } })
      expect(applied?.emailBody).toBe(emailBody)

      // And the editor shows the email content, not just the push line.
      await page.goto(`/classes/${b.classRunId}`)
      await page.getByRole('button', { name: 'Reminders & messages' }).click()
      await expect(page.getByText('E2E What to bring')).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // In-app is a staff-only channel: a client already gets the push/email, and
  // mirroring every one into their feed made the feed useless. Staff DO read
  // their bell, so a STAFF step keeps it — including when the audience is
  // switched over on an existing step.
  test('in-app is kept for staff and stripped for clients', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Staff Flow Class', sessionCount: 2, weeksBetween: 1, durationMins: 60, isGroup: true, startAt: inDays(10).toISOString() },
      })
      const b = await res.json()
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      const create = await page.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, {
        data: {
          direction: 'BEFORE_SESSION', offsetMinutes: 60, channels: ['PUSH', 'IN_APP'],
          audience: 'STAFF', important: false, title: 'E2E Staff heads-up',
          body: 'You are on {{class}} at {{time}}.', enabled: true,
        },
      })
      expect(create.status(), await create.text()).toBe(201)
      const step = await create.json()
      expect(step.audience).toBe('STAFF')
      expect(step.channels).toEqual(['PUSH', 'IN_APP'])

      // Point the same step at clients and the in-app channel goes with it.
      const patch = await page.request.patch(`/api/trainer/class-runs/${b.classRunId}/comms-flow/${step.id}`, {
        data: { audience: 'ENROLLED' },
      })
      expect(patch.status(), await patch.text()).toBe(200)
      expect((await patch.json()).channels).toEqual(['PUSH'])
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })

  // The screen is a timeline: read top to bottom in the order the messages will
  // actually go out, never the order they were added. Each stop states its own
  // when / how / who on separate lines, and opening one offers a preview of
  // what a real client receives.
  test('the flow reads as a timeline, in time order, with a preview', async ({ page }) => {
    const prisma = await makePrisma()
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/packages', {
        data: { name: 'E2E Timeline Class', sessionCount: 2, weeksBetween: 1, durationMins: 60, isGroup: true, startAt: inDays(10).toISOString() },
      })
      const b = await res.json()
      cleanup.push(() => prisma.commsFlowStep.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.trainingSession.deleteMany({ where: { classRunId: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.classRun.delete({ where: { id: b.classRunId } }).catch(() => {}))
      cleanup.push(() => prisma.package.delete({ where: { id: b.id } }).catch(() => {}))

      // Added deliberately out of order: last-to-fire first.
      for (const s of [
        { direction: 'AFTER_SESSION', offsetMinutes: 120, title: 'E2E Third' },
        { direction: 'BEFORE_SESSION', offsetMinutes: 15, title: 'E2E Second' },
        { direction: 'BEFORE_SESSION', offsetMinutes: 10080, title: 'E2E First' },
      ]) {
        const r = await page.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, {
          data: { ...s, channels: ['PUSH'], audience: 'ENROLLED', important: false, body: 'Hi {{name}}, {{dog}} has {{class}} soon.', enabled: true },
        })
        expect(r.status(), await r.text()).toBe(201)
      }

      await page.goto(`/classes/${b.classRunId}`)
      await page.getByRole('button', { name: 'Reminders & messages' }).click()
      await expect(page.getByText('E2E First')).toBeVisible({ timeout: 15_000 })

      const stops = page.locator('ol > li')
      await expect(stops).toHaveCount(3)
      // Time order, not the order they were created in.
      await expect(stops.nth(0)).toContainText('E2E First')
      await expect(stops.nth(1)).toContainText('E2E Second')
      await expect(stops.nth(2)).toContainText('E2E Third')
      // …and each stop carries its own when / how / who.
      await expect(stops.nth(0)).toContainText('1 week before')
      await expect(stops.nth(0)).toContainText('Push')
      await expect(stops.nth(0)).toContainText('Everyone booked')

      // Opening a stop offers the preview, which fills the placeholders in.
      await stops.nth(0).getByRole('button').first().click()
      await expect(page.getByRole('dialog', { name: 'Message' })).toBeVisible()
      await page.getByRole('button', { name: 'Preview', exact: true }).click()
      const preview = page.getByRole('dialog', { name: 'Preview' })
      await expect(preview).toBeVisible()
      await expect(preview).not.toContainText('{{name}}')
      await expect(preview).toContainText('E2E Timeline Class') // the real offering, not a sample
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
      // Don't follow redirects: the middleware bounces an unauthenticated call
      // to /login, and following that turns the rejection into a 200 HTML page.
      // What matters is that it never succeeds and never writes a step.
      const guard = await anon.request.post(`/api/trainer/class-runs/${b.classRunId}/comms-flow`, {
        data: { title: 'x' },
        maxRedirects: 0,
      })
      expect([302, 307, 401, 403]).toContain(guard.status())
      expect(await prisma.commsFlowStep.count({ where: { classRunId: b.classRunId } })).toBe(0)
      await anon.close()
    } finally {
      for (const fn of cleanup.reverse()) await fn()
      await prisma.$disconnect()
    }
  })
})
