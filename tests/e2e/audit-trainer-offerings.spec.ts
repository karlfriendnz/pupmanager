/**
 * PROBE (not a suite test — underscore-prefixed, excluded).
 *
 * "Have you checked all the fields when editing an offering?" — Karl, 2026-08-04.
 *
 * Sends every field the offering editor can send, one distinct value each,
 * through the same PATCH the form uses, then reads the row back out of the
 * database and prints anything that didn't stick. A field that is silently
 * dropped is the C-1 shape of bug: the trainer types it, the save succeeds,
 * and the value is gone.
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

/** How the stored value should read back for a given sent value. */
function same(sent: unknown, stored: unknown): boolean {
  if (sent === null) return stored === null
  if (stored instanceof Date) return stored.toISOString().startsWith(String(sent).slice(0, 10))
  return String(sent) === String(stored)
}

test('probe · every field sent by the offering editor round-trips', async ({ page }) => {
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let oneToOneId: string | null = null
  let groupId: string | null = null
  try {
    await login(page)

    // ── A 1:1 offering ───────────────────────────────────────────────────────
    const made = await page.request.post('/api/packages', {
      data: { name: `Probe 1to1 ${tag}`, sessionCount: 4, weeksBetween: 1, durationMins: 60 },
    })
    expect(made.status(), await made.text()).toBeLessThan(300)
    oneToOneId = (await made.json()).id

    const oneToOne: Record<string, unknown> = {
      name: `Probe renamed ${tag}`,
      description: '<p>Probe description</p>',
      sessionCount: 6,
      weeksBetween: 2,
      durationMins: 45,
      bufferMins: 15,
      sessionType: 'VIRTUAL',
      priceCents: 24000,
      specialPriceCents: 19900,
      pricePerSessionCents: 4000,
      color: 'teal',
      requireSessionNotes: false,
      allowWaitlist: true,
      clientSelfBook: true,
      selfBookRequiresApproval: false,
      // Stored as an instant on `visibleFrom`, deliberately — see the route.
      visibleFromDate: '2027-01-15',
      xeroAccountCode: '4321',
      requirePayment: true,
      imageUrl: 'https://blob.example.test/probe-cover.jpg',
      recurrenceRule: 'FREQ=WEEKLY;COUNT=6',
    }
    const patched = await page.request.patch(`/api/packages/${oneToOneId}`, { data: oneToOne })
    console.log(`\n=== 1:1 PATCH -> ${patched.status()}`)
    if (!patched.ok()) console.log('   BODY:', (await patched.text()).slice(0, 400))

    const rowA = await prisma.package.findUniqueOrThrow({ where: { id: oneToOneId! } })
    for (const [key, sent] of Object.entries(oneToOne)) {
      const column = key === 'visibleFromDate' ? 'visibleFrom' : key
      const stored = (rowA as Record<string, unknown>)[column]
      // pricePerSessionCents re-derives the total, so priceCents is expected to
      // move with it — flagged, not judged.
      console.log(
        `${same(sent, stored) ? '  ok  ' : '  ✗   '}${key.padEnd(26)} sent=${JSON.stringify(sent)} stored=${JSON.stringify(stored)}`,
      )
    }

    // ── A group class ────────────────────────────────────────────────────────
    const madeG = await page.request.post('/api/packages', {
      data: { name: `Probe class ${tag}`, sessionCount: 5, weeksBetween: 1, durationMins: 60, isGroup: true },
    })
    expect(madeG.status(), await madeG.text()).toBeLessThan(300)
    groupId = (await madeG.json()).id

    const group: Record<string, unknown> = {
      isGroup: true,
      capacity: 8,
      allowDropIn: true,
      dropInPriceCents: 3500,
      publicEnrollment: true,
      scheduleNote: 'Meet by the big gate',
      location: 'Cornwall Park, Auckland',
    }
    const patchedG = await page.request.patch(`/api/packages/${groupId}`, { data: group })
    console.log(`\n=== group PATCH -> ${patchedG.status()}`)
    if (!patchedG.ok()) console.log('   BODY:', (await patchedG.text()).slice(0, 400))

    const rowB = await prisma.package.findUniqueOrThrow({ where: { id: groupId! } })
    for (const [key, sent] of Object.entries(group)) {
      const stored = (rowB as Record<string, unknown>)[key]
      console.log(
        `${same(sent, stored) ? '  ok  ' : '  ✗   '}${key.padEnd(26)} sent=${JSON.stringify(sent)} stored=${JSON.stringify(stored)}`,
      )
    }
    // scheduleNote / location live on the RUN, not the package — say where they went.
    const runs = await prisma.classRun.findMany({ where: { packageId: groupId! } })
    console.log(`   runs=${runs.length}`, runs.map(r => ({ note: r.scheduleNote, loc: r.location })))
  } finally {
    for (const id of [oneToOneId, groupId]) {
      if (!id) continue
      await prisma.classRun.deleteMany({ where: { packageId: id } }).catch(() => {})
      await prisma.package.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})
