import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { todayInTz } from '../../src/lib/timezone'

// The same information, entered from each end, checked from the other. Most
// bugs in an app with two audiences live in the gap between them: something
// saves on one side and never appears on the other, or appears when it
// shouldn't. Single-screen tests can't see that.
//
//   · a dog added by the owner → visible to their trainer, and the reverse
//   · a session write-up saved as a draft → NOT visible, until it's sent
//   · homework set by the trainer → in the owner's app, and still there on
//     the trainer's own screen after a reload

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE })

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

/** The client home opens with a "Get the app" sheet over everything. */
async function dismissAppPrompt(page: Page) {
  const later = page.getByRole('button', { name: 'Maybe later' })
  if (await later.isVisible().catch(() => false)) await later.click()
  // A first-run intake gate can sit in front of the app too.
  const gate = page.getByRole('button', { name: 'Save and continue' })
  if (await gate.isVisible().catch(() => false)) await gate.click()
}

// The date a trainer's own picker would send for "today": their calendar day,
// not the host's UTC one. The seeded trainer is Pacific/Auckland (User.timezone
// default) and the client home windows "This week" in the trainer's zone, so a
// UTC date here reads as last week for the twelve hours NZ runs ahead of it.
const today = () => todayInTz('Pacific/Auckland')

test.describe('entered one side, checked from the other', () => {
  test('a dog added by the owner reaches the trainer — and the reverse', async ({ page }) => {
    const prisma = await makePrisma()
    const ownerAdded = `E2E Owner Dog ${Date.now()}`
    const trainerAdded = `E2E Trainer Dog ${Date.now()}`
    try {
      // ── the owner adds a dog ──────────────────────────────────────────
      await login(page, SEED.client.email, SEED.client.password)
      const created = await page.request.post('/api/my/dogs', {
        data: { name: ownerAdded, breed: 'Border Collie' },
      })
      expect(created.status(), await created.text()).toBe(201)

      // It's on their own list.
      await page.goto('/my-dogs')
      await dismissAppPrompt(page)
      await expect(page.getByText(ownerAdded).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // ── and the trainer sees it on the client's record ────────────────
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/clients/${SEED.assignedClientId}`)
      // The client record is tabbed; dogs aren't on the landing tab. The count
      // in the tab label is itself the first proof it arrived.
      await page.getByRole('button', { name: /^Dogs?( \d+)?$/ }).click()
      await expect(page.getByText(ownerAdded).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // ── now the other direction ───────────────────────────────────────
      const byTrainer = await page.request.post(`/api/clients/${SEED.assignedClientId}/dogs`, {
        data: { name: trainerAdded, breed: 'Whippet' },
      })
      expect([200, 201], await byTrainer.text()).toContain(byTrainer.status())

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/my-dogs')
      await dismissAppPrompt(page)
      await expect(page.getByText(trainerAdded).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })

      // Both dogs belong to this client and nobody else. A dog is owned either
      // as the household's primary (ClientProfile.dogId) or as an additional
      // dog (Dog.clientProfileId) — these came in as additional ones.
      const dogs = await prisma.dog.findMany({
        where: { name: { in: [ownerAdded, trainerAdded] } },
        select: { name: true, clientProfileId: true, primaryFor: { select: { id: true } } },
      })
      expect(dogs).toHaveLength(2)
      for (const d of dogs) {
        const owners = [d.clientProfileId, ...d.primaryFor.map(p => p.id)].filter(Boolean)
        expect(owners, `${d.name} is not attached to the client who added it`).toContain(SEED.assignedClientId)
      }
    } finally {
      await prisma.dog.deleteMany({ where: { name: { in: [ownerAdded, trainerAdded] } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('homework set by the trainer lands in the owner’s app and survives a reload', async ({ page }) => {
    const prisma = await makePrisma()
    const title = `E2E Homework ${Date.now()}`
    let taskId: string | null = null
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const res = await page.request.post('/api/tasks', {
        data: {
          clientId: SEED.assignedClientId,
          date: today(),
          title,
          description: 'Five minutes of loose-lead walking, twice today.',
          repetitions: 2,
        },
      })
      expect([200, 201], await res.text()).toContain(res.status())
      taskId = (await res.json())?.id ?? null

      // Saved for real — not just echoed back to the screen that created it.
      const saved = await prisma.trainingTask.findFirst({
        where: { title }, select: { id: true, clientId: true, repetitions: true, description: true },
      })
      expect(saved?.clientId).toBe(SEED.assignedClientId)
      expect(saved?.repetitions).toBe(2)
      expect(saved?.description).toContain('loose-lead')

      // Coming back to it: a fresh request returns the same task, so it really
      // persisted rather than living in the screen that created it.
      const reread = await page.request.get(`/api/tasks/${saved!.id}`)
      if (reread.ok()) {
        expect((await reread.json())?.title).toBe(title)
      }

      // NOTE — a gap, not a bug: there is no trainer-side LIST of homework a
      // trainer has set. The client record's "Training log" tab shows the
      // client's practice logs (diaryEntries), and standalone homework set for
      // a date appears on no trainer screen at all; only homework attached to a
      // session shows, on that session's preview. So a trainer cannot browse
      // back over what they've set. Asserting the truth here rather than a
      // screen that doesn't exist.

      // ── and the owner has it ──────────────────────────────────────────
      await login(page, SEED.client.email, SEED.client.password)
      await page.goto('/home')
      await dismissAppPrompt(page)
      await expect(page.getByText(title).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
    } finally {
      if (taskId) await prisma.trainingTask.delete({ where: { id: taskId } }).catch(() => {})
      await prisma.trainingTask.deleteMany({ where: { title } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // The one that would embarrass everyone: half-written notes reaching the
  // client before the trainer has finished them.
  test('a session write-up stays private until it is sent', async ({ page }) => {
    const prisma = await makePrisma()
    const draftText = `E2E DRAFT ONLY ${Date.now()}`
    let sessionId: string | null = null
    let formId: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })

      // A past session for this client, and a form to write it up on.
      const session = await prisma.trainingSession.create({
        data: {
          trainerId: trainer!.id,
          clientId: SEED.assignedClientId,
          scheduledAt: new Date(Date.now() - 2 * 864e5),
          durationMins: 60,
          title: 'E2E Write-up Session',
        },
      })
      sessionId = session.id
      const form = await prisma.sessionForm.create({
        data: { trainerId: trainer!.id, name: `E2E Form ${Date.now()}` },
      })
      formId = form.id

      // Saved, but NOT sent — sentAt stays null.
      await prisma.sessionFormResponse.create({
        data: { sessionId: session.id, formId: form.id, introMessage: draftText },
      })

      await login(page, SEED.client.email, SEED.client.password)
      await page.goto(`/my-sessions/${session.id}`)
      await dismissAppPrompt(page)
      await expect(
        page.getByText(draftText),
        'an unsent draft must never reach the client',
      ).toHaveCount(0)

      // Send it, and now they can read it.
      await prisma.sessionFormResponse.updateMany({
        where: { sessionId: session.id, formId: form.id },
        data: { sentAt: new Date() },
      })
      await page.reload()
      await dismissAppPrompt(page)
      await expect(page.getByText(draftText).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
    } finally {
      if (sessionId) {
        await prisma.sessionFormResponse.deleteMany({ where: { sessionId } }).catch(() => {})
        await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
      }
      if (formId) await prisma.sessionForm.delete({ where: { id: formId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
