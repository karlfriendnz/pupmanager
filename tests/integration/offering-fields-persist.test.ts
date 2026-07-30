/**
 * Does an edit to an offering actually STICK?
 *
 * Every other route test in this repo mocks Prisma, which means they prove the
 * handler calls the right function with the right argument and prove nothing at
 * all about whether the value reaches a column. That is precisely the class of
 * bug this file exists for: "class capacity is not saving" was reported against
 * code whose capacity plumbing reads correctly end to end.
 *
 * So this one talks to a REAL database — the local sandbox, never anything else
 * (it refuses to run otherwise). It creates a throwaway offering of each kind,
 * PATCHes every field the editor can change, reads the row back, and compares.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx vitest run tests/integration/offering-fields-persist.test.ts
 *
 * Excluded from the default `vitest` run (see vitest.config) because it needs a
 * database; it is a pre-deploy check, not a unit test.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const TRAINER_EMAIL = 'thepetplace@pupmanager.dev'

// Only auth is faked. Prisma is real, on purpose — a mocked client cannot tell
// you whether a column moved.
const h = vi.hoisted(() => ({ trainerId: '' }))
vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: 'test-user', role: 'TRAINER', trainerId: h.trainerId } }),
}))
vi.mock('@/lib/membership', async (orig) => ({
  ...(await orig() as object),
  guardPermission: async () => ({ trainerId: h.trainerId }),
}))

import { prisma } from '@/lib/prisma'
import { PATCH } from '@/app/api/packages/[packageId]/route'

const created: string[] = []

function patch(packageId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/packages/${packageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ packageId }) },
  )
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url) || !/pupmanager_dev/.test(url)) {
    throw new Error(`Refusing to run: DATABASE_URL is not the local sandbox (${url.replace(/:[^@/]*@/, ':***@')})`)
  }
  const user = await prisma.user.findUnique({
    where: { email: TRAINER_EMAIL },
    select: { trainerProfile: { select: { id: true } } },
  })
  if (!user?.trainerProfile) throw new Error(`No trainer ${TRAINER_EMAIL} in the local sandbox`)
  h.trainerId = user.trainerProfile.id
})

afterAll(async () => {
  for (const id of created) {
    await prisma.trainingSession.deleteMany({ where: { classRun: { packageId: id } } }).catch(() => {})
    await prisma.classRun.deleteMany({ where: { packageId: id } }).catch(() => {})
    await prisma.package.delete({ where: { id } }).catch(() => {})
  }
  await prisma.$disconnect()
})

async function makeOffering(name: string, isGroup: boolean, withRun: boolean) {
  const pkg = await prisma.package.create({
    data: {
      trainerId: h.trainerId, name, sessionCount: 4, weeksBetween: 1,
      durationMins: 60, sessionType: 'IN_PERSON', isGroup, capacity: isGroup ? 6 : null, order: 0,
    },
    select: { id: true },
  })
  created.push(pkg.id)
  if (withRun) {
    await prisma.classRun.create({
      data: {
        trainerId: h.trainerId, packageId: pkg.id, name,
        startDate: new Date('2026-09-01T10:00:00Z'), capacity: 6,
      },
    })
  }
  return pkg.id
}

describe('an offering edit reaches the database', () => {
  it('saves capacity on the package AND the run behind it', async () => {
    const id = await makeOffering('TEST capacity group', true, true)

    const res = await patch(id, { capacity: 11 })
    expect(res.status).toBe(200)

    const pkg = await prisma.package.findUnique({ where: { id }, select: { capacity: true } })
    const run = await prisma.classRun.findFirst({ where: { packageId: id }, select: { capacity: true } })

    expect(pkg?.capacity, 'package.capacity').toBe(11)
    // The run's own value OVERRIDES the package's wherever seats are counted,
    // so a package-only write shows the OLD number on screen and reads as
    // "capacity did not save". This is the assertion that catches that.
    expect(run?.capacity, 'classRun.capacity (the one the UI reads)').toBe(11)
  })

  it('clears capacity to unlimited on both', async () => {
    const id = await makeOffering('TEST capacity clear', true, true)
    expect((await patch(id, { capacity: null })).status).toBe(200)
    const pkg = await prisma.package.findUnique({ where: { id }, select: { capacity: true } })
    const run = await prisma.classRun.findFirst({ where: { packageId: id }, select: { capacity: true } })
    expect(pkg?.capacity, 'package.capacity').toBeNull()
    expect(run?.capacity, 'classRun.capacity').toBeNull()
  })

  // Every scalar the offerings editor can change, one field at a time so a
  // failure names the field rather than "the payload".
  const SCALARS: Array<[string, unknown, (p: Record<string, unknown>) => unknown]> = [
    ['name', 'TEST renamed', p => p.name],
    ['description', 'a new description', p => p.description],
    ['durationMins', 45, p => p.durationMins],
    ['bufferMins', 15, p => p.bufferMins],
    ['sessionType', 'VIRTUAL', p => p.sessionType],
    ['priceCents', 12345, p => p.priceCents],
    ['color', 'teal', p => p.color],
    ['allowWaitlist', true, p => p.allowWaitlist],
    ['publicEnrollment', true, p => p.publicEnrollment],
    ['clientSelfBook', true, p => p.clientSelfBook],
    ['selfBookRequiresApproval', true, p => p.selfBookRequiresApproval],
    ['requireSessionNotes', true, p => p.requireSessionNotes],
    ['requirePayment', true, p => p.requirePayment],
    ['xeroAccountCode', '4000', p => p.xeroAccountCode],
    ['allowDropIn', true, p => p.allowDropIn],
    ['dropInPriceCents', 2500, p => p.dropInPriceCents],
  ]

  for (const [field, value, read] of SCALARS) {
    it(`saves ${field}`, async () => {
      const id = await makeOffering(`TEST field ${field}`, true, true)
      const res = await patch(id, { [field]: value })
      expect(res.status, `${field} PATCH status`).toBe(200)
      const row = await prisma.package.findUnique({ where: { id } })
      expect(read(row as unknown as Record<string, unknown>), field).toEqual(value)
    })
  }

  it('saves fields on a 1:1 offering too (no run behind it)', async () => {
    const id = await makeOffering('TEST one-to-one', false, false)
    const res = await patch(id, { name: 'TEST 1:1 renamed', durationMins: 30, priceCents: 8000 })
    expect(res.status).toBe(200)
    const row = await prisma.package.findUnique({ where: { id } })
    expect(row?.name).toBe('TEST 1:1 renamed')
    expect(row?.durationMins).toBe(30)
    expect(row?.priceCents).toBe(8000)
  })

  it('saves capacity on a SLOT-SCHEDULED drop-in class', async () => {
    // A drop-in's series comes from its slots, so syncOfferingRun deliberately
    // leaves its sessions alone. The capacity write must not be skipped along
    // with them — this is the exact shape of the drifted rows in production
    // ("Drop-In Class": package 12, run 8).
    const id = await makeOffering('TEST dropin slots', true, true)
    await prisma.package.update({ where: { id }, data: { allowDropIn: true } })
    const run = await prisma.classRun.findFirstOrThrow({ where: { packageId: id }, select: { id: true } })
    const slot = await prisma.packageSessionSlot.create({
      data: { packageId: id, day: 2, startTime: '10:00', endTime: '11:00', order: 0 },
      select: { id: true },
    })
    await prisma.trainingSession.create({
      data: {
        trainerId: h.trainerId, classRunId: run.id, sessionIndex: 1,
        title: 'TEST dropin session', scheduledAt: new Date('2026-09-01T10:00:00Z'),
        durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON',
        packageSessionSlotId: slot.id,
      },
    })

    expect((await patch(id, { capacity: 14 })).status).toBe(200)
    const pkg = await prisma.package.findUnique({ where: { id }, select: { capacity: true } })
    const after = await prisma.classRun.findUnique({ where: { id: run.id }, select: { capacity: true } })
    expect(pkg?.capacity, 'package.capacity').toBe(14)
    expect(after?.capacity, 'classRun.capacity on a slot-scheduled run').toBe(14)
  })

  it('saves capacity on a group offering that has no run yet', async () => {
    // 16 group packages in production have zero runs. syncOfferingRun no-ops on
    // them by design; the package write must still land.
    const id = await makeOffering('TEST group no run', true, false)
    expect((await patch(id, { capacity: 9 })).status).toBe(200)
    const row = await prisma.package.findUnique({ where: { id }, select: { capacity: true } })
    expect(row?.capacity).toBe(9)
  })
})
