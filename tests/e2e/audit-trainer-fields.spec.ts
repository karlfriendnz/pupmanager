/**
 * TRAINER-SIDE FIELD AUDIT — "does what I typed actually save?"
 *
 * Companion to the offering probe. Same method: send every field an editor can
 * send, one distinct value each, through the API the form uses, then read the
 * row back out of the database and report anything that didn't stick.
 *
 * Reports rather than asserts where the answer isn't known yet — a ✗ line is a
 * finding to chase, not necessarily a bug (a field may legitimately live on
 * another table). Confirmed bugs graduate into assertions.
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

function report(label: string, sent: Record<string, unknown>, row: Record<string, unknown>) {
  console.log(`\n=== ${label}`)
  for (const [key, value] of Object.entries(sent)) {
    const stored = row[key]
    const ok = value === null ? stored === null : String(value) === String(stored)
    console.log(`${ok ? '  ok  ' : '  ✗   '}${key.padEnd(22)} sent=${JSON.stringify(value)} stored=${JSON.stringify(stored)}`)
  }
}

test('probe · a product keeps every field it was given', async ({ page }) => {
  test.setTimeout(120_000)
  const prisma = await makePrisma()
  let id = ''
  try {
    await login(page)
    const made = await page.request.post('/api/products', {
      data: { name: `Probe product ${Date.now()}`, priceCents: 1000 },
    })
    expect(made.status(), await made.text()).toBeLessThan(300)
    id = (await made.json()).id

    const sent = {
      name: 'Probe product renamed',
      description: '<p>A probe description</p>',
      kind: 'DIGITAL',
      priceCents: 4500,
      salePriceCents: 3900,
      downloadUrl: 'https://blob.example.test/probe.pdf',
      imageUrl: 'https://blob.example.test/probe.jpg',
      featured: true,
      active: false,
      xeroAccountCode: '4010',
      requirePayment: true,
    }
    const res = await page.request.patch(`/api/products/${id}`, { data: sent })
    console.log(`product PATCH -> ${res.status()}`)
    if (!res.ok()) console.log('  BODY:', (await res.text()).slice(0, 300))
    report('PRODUCT', sent, (await prisma.product.findUniqueOrThrow({ where: { id } })) as never)
  } finally {
    if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('probe · a client keeps every field they were given', async ({ page }) => {
  test.setTimeout(120_000)
  const prisma = await makePrisma()
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    const client = await prisma.clientProfile.findFirstOrThrow({
      where: { trainerId: trainer.id },
      select: { id: true, phone: true, notes: true, status: true, user: { select: { name: true } } },
    })

    const sent = {
      name: 'Probe Client Name',
      phone: '+64 21 555 9999',
      status: 'INACTIVE',
      notes: 'Probe private note',
    }
    const res = await page.request.patch(`/api/clients/${client.id}`, { data: sent })
    console.log(`client PATCH -> ${res.status()}`)
    if (!res.ok()) console.log('  BODY:', (await res.text()).slice(0, 300))

    const row = await prisma.clientProfile.findUniqueOrThrow({
      where: { id: client.id },
      select: { phone: true, notes: true, status: true, user: { select: { name: true } } },
    })
    report('CLIENT', sent, { ...row, name: row.user?.name } as never)

    // The address is saved by its OWN route, and a hand-typed one that never
    // matched a Places suggestion has to be kept too — dropping it is what made
    // a customer report "Address is required" with an address on screen.
    const addr = await page.request.patch(`/api/clients/${client.id}/location`, {
      data: { address: '5 Probe Street, Auckland' },
    })
    console.log(`client location PATCH -> ${addr.status()}`)
    const after = await prisma.clientProfile.findUniqueOrThrow({
      where: { id: client.id },
      select: { addressLine: true, addressLat: true },
    })
    report('CLIENT ADDRESS (typed, not picked)', { addressLine: '5 Probe Street, Auckland' }, after as never)

    // Put the shared client back.
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { phone: client.phone, notes: client.notes, status: client.status, addressLine: null },
    })
    if (client.user?.name) {
      await prisma.user.updateMany({
        where: { clientProfiles: { some: { id: client.id } } },
        data: { name: client.user.name },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
})

test('probe · a SCHEDULED class keeps the fields that live on its run', async ({ page }) => {
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  let id = ''
  try {
    await login(page)
    const start = new Date(Date.now() + 14 * 864e5)
    const made = await page.request.post('/api/packages', {
      data: {
        name: `Probe scheduled ${Date.now()}`, sessionCount: 4, weeksBetween: 1,
        durationMins: 60, isGroup: true, startAt: start.toISOString(),
      },
    })
    expect(made.status(), await made.text()).toBeLessThan(300)
    id = (await made.json()).id

    const sent = { scheduleNote: 'Thursdays 4:00pm', location: 'Cornwall Park', capacity: 12 }
    const res = await page.request.patch(`/api/packages/${id}`, { data: sent })
    console.log(`scheduled class PATCH -> ${res.status()}`)
    if (!res.ok()) console.log('  BODY:', (await res.text()).slice(0, 300))

    const runs = await prisma.classRun.findMany({ where: { packageId: id } })
    console.log(`  runs=${runs.length}`)
    if (runs[0]) report('CLASS RUN', sent, runs[0] as never)
    report('PACKAGE', sent, (await prisma.package.findUniqueOrThrow({ where: { id } })) as never)
  } finally {
    if (id) {
      await prisma.classRun.deleteMany({ where: { packageId: id } }).catch(() => {})
      await prisma.package.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})
