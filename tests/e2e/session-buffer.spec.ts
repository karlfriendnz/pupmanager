import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { zonedToUtc } from '../../src/lib/timezone'

// "Gap before the next session" (the turnaround buffer). Three things have to be
// true against the real app + DB:
//   1. the trainer can set it where packages are edited;
//   2. a booked session's buffer shows on the scheduler as an extension of the
//      event block (not a standalone event);
//   3. nothing can be booked into it — a slot starting inside the buffer clashes,
//      one starting exactly when the buffer ends does not.
const LOCAL_DATE = { y: 2030, m: 3, d: 5 } // a Tuesday, far enough out to be empty
const DATE_STR = '2030-03-05'

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

test('a session’s buffer blocks bookings and renders as part of its block on the schedule', async ({ page }) => {
  const prisma = db()
  let sessionId = ''
  try {
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName },
      include: { user: { select: { timezone: true } } },
    })
    const tz = trainer!.user.timezone

    // A 10:00–11:00 session (trainer-local) with a 30-minute turnaround gap:
    // occupied until 11:30.
    const startsAt = zonedToUtc(LOCAL_DATE.y, LOCAL_DATE.m, LOCAL_DATE.d, 10, 0, tz)
    const created = await prisma.trainingSession.create({
      data: {
        trainerId: trainer!.id,
        clientId: SEED.assignedClientId,
        title: 'Buffered Session',
        scheduledAt: startsAt,
        durationMins: 60,
        bufferMins: 30,
      },
    })
    sessionId = created.id

    await login(page, SEED.owner.email, SEED.owner.password)

    // ── 1. The trainer control exists where packages are edited ───────────────
    await page.goto('/packages/new')
    await expect(page.getByLabel('Gap before the next session')).toBeVisible()

    // ── 2. The buffer renders as a continuation of ITS event block ────────────
    await page.goto(`/schedule?date=${DATE_STR}`)
    const block = page.locator(`[data-testid="session-block"][data-session-id="${sessionId}"]`).first()
    await expect(block).toBeVisible({ timeout: 20_000 })

    const buffer = page.locator(`[data-testid="session-buffer"][data-session-id="${sessionId}"]`).first()
    await expect(buffer).toBeVisible()
    await expect(buffer).toHaveAttribute('data-buffer-mins', '30')
    await expect(buffer).toContainText('30 min buffer')

    // It's an EXTENSION of that event, not a standalone one: same column (same
    // left edge + width), flush under the block, and not clickable.
    const blockBox = (await block.boundingBox())!
    const bufferBox = (await buffer.boundingBox())!
    expect(Math.abs(bufferBox.x - blockBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(bufferBox.width - blockBox.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(bufferBox.y - (blockBox.y + blockBox.height))).toBeLessThanOrEqual(1)
    // 30 min against a 60 min session ⇒ half its height.
    expect(Math.abs(bufferBox.height - blockBox.height / 2)).toBeLessThanOrEqual(2)
    await expect(buffer).toHaveCSS('pointer-events', 'none')

    // ── 3. Nothing can be booked into it ─────────────────────────────────────
    const iso = (h: number, min: number) =>
      zonedToUtc(LOCAL_DATE.y, LOCAL_DATE.m, LOCAL_DATE.d, h, min, tz).toISOString()

    // 11:00 — the session has ended but its buffer has not: a clash.
    const inBuffer = await page.request.get(
      `/api/schedule/conflicts?start=${encodeURIComponent(iso(11, 0))}&end=${encodeURIComponent(iso(12, 0))}`,
    )
    expect(inBuffer.ok()).toBeTruthy()
    const inBufferBody = await inBuffer.json()
    expect(inBufferBody.sessionConflicts).toHaveLength(1)
    expect(inBufferBody.sessionConflicts[0].title).toBe('Buffered Session')

    // 11:30 — exactly when the buffer ends: allowed.
    const atBufferEnd = await page.request.get(
      `/api/schedule/conflicts?start=${encodeURIComponent(iso(11, 30))}&end=${encodeURIComponent(iso(12, 30))}`,
    )
    const atBufferEndBody = await atBufferEnd.json()
    expect(atBufferEndBody.sessionConflicts).toHaveLength(0)
  } finally {
    if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('another business cannot see a buffered session through the conflicts API', async ({ page }) => {
  const prisma = db()
  let sessionId = ''
  try {
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName },
      include: { user: { select: { timezone: true } } },
    })
    const tz = trainer!.user.timezone
    const startsAt = zonedToUtc(LOCAL_DATE.y, LOCAL_DATE.m, LOCAL_DATE.d, 10, 0, tz)
    const created = await prisma.trainingSession.create({
      data: {
        trainerId: trainer!.id,
        clientId: SEED.assignedClientId,
        title: 'Buffered Session (tenant guard)',
        scheduledAt: startsAt,
        durationMins: 60,
        bufferMins: 30,
      },
    })
    sessionId = created.id

    // Business B's owner asks about the very slot A's buffer occupies — the
    // buffer is A's business, so B must see a clean calendar.
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    const iso = (h: number, min: number) =>
      zonedToUtc(LOCAL_DATE.y, LOCAL_DATE.m, LOCAL_DATE.d, h, min, tz).toISOString()
    const res = await page.request.get(
      `/api/schedule/conflicts?start=${encodeURIComponent(iso(11, 0))}&end=${encodeURIComponent(iso(12, 0))}`,
    )
    expect(res.ok()).toBeTruthy()
    expect((await res.json()).sessionConflicts).toHaveLength(0)
  } finally {
    if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
    await prisma.$disconnect()
  }
})
