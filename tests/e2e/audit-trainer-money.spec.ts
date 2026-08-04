/**
 * TRAINER-SIDE MONEY AUDIT — what happens to the receivable when the booking
 * changes.
 *
 * The client audit's worst finding (C-3) was an undo that undid one of the three
 * things the action did: cancelling a shop order deleted the request and left
 * the invoice standing and the stock spent. Class enrolment is the same shape on
 * a much bigger number, so this asks the same two questions of it:
 *
 *   1. withdraw someone — does the money they owe go away with them?
 *   2. promote someone off the waitlist — does anyone bill them?
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { SEED, TEST_DATABASE_URL } from './test-db'

const PASSWORD = 'AuditPass123!'

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

/* eslint-disable @typescript-eslint/no-explicit-any */
async function makeClient(prisma: any, trainerId: string, tag: string) {
  const hash = await bcrypt.hash(PASSWORD, 12)
  const user = await prisma.user.create({
    data: {
      email: `money-audit-${tag}@e2e.test`, name: `Money Audit ${tag}`, role: 'CLIENT',
      emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const dog = await prisma.dog.create({ data: { name: `Money Dog ${tag}` } })
  const client = await prisma.clientProfile.create({
    data: { userId: user.id, trainerId, dogId: dog.id, status: 'ACTIVE', phone: '+6421000999' },
  })
  return { userId: user.id, dogId: dog.id, clientId: client.id }
}

test('a withdrawn enrolment does not leave the client owing, and a promoted one gets billed', async ({ page }) => {
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  const made: { userId: string; dogId: string; clientId: string }[] = []
  let packageId = ''
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })

    // A priced class with exactly one seat, so the second booking waits.
    const created = await page.request.post('/api/packages', {
      data: {
        name: `Money audit class ${tag}`, sessionCount: 4, weeksBetween: 1, durationMins: 60,
        isGroup: true, capacity: 1, allowWaitlist: true, priceCents: 12000,
        startAt: new Date(Date.now() + 21 * 864e5).toISOString(),
      },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    packageId = (await created.json()).id
    const run = await prisma.classRun.findFirstOrThrow({ where: { packageId } })

    const a = await makeClient(prisma, trainer.id, `${tag}a`)
    const b = await makeClient(prisma, trainer.id, `${tag}b`)
    made.push(a, b)

    // A takes the seat, B goes on the waitlist.
    const enrolA = await page.request.post(`/api/class-runs/${run.id}/enrollments`, {
      data: { clientId: a.clientId, dogId: a.dogId },
    })
    expect(enrolA.status(), await enrolA.text()).toBeLessThan(300)
    const enrolB = await page.request.post(`/api/class-runs/${run.id}/enrollments`, {
      data: { clientId: b.clientId, dogId: b.dogId },
    })
    expect(enrolB.status(), await enrolB.text()).toBeLessThan(300)

    const rowA = await prisma.classEnrollment.findFirstOrThrow({
      where: { classRunId: run.id, clientId: a.clientId },
    })
    const rowB = await prisma.classEnrollment.findFirstOrThrow({
      where: { classRunId: run.id, clientId: b.clientId },
    })
    expect(rowA.status, 'A takes the only seat').toBe('ENROLLED')
    expect(rowB.status, 'B waits').toBe('WAITLISTED')

    // Enrolling raised A's receivable.
    const owedByA = await prisma.invoice.count({
      where: { clientId: a.clientId, sourceType: 'CLASS_ENROLLMENT', status: 'UNPAID' },
    })
    expect(owedByA, 'enrolling bills them').toBe(1)

    // ── The question ─────────────────────────────────────────────────────────
    const withdrawn = await page.request.delete(`/api/class-runs/${run.id}/enrollments/${rowA.id}`)
    expect(withdrawn.status(), await withdrawn.text()).toBe(200)

    // 1. A is out, so A must not still owe for the seat.
    const stillOwedByA = await prisma.invoice.count({
      where: { clientId: a.clientId, sourceType: 'CLASS_ENROLLMENT', status: { not: 'CANCELLED' } },
    })
    expect(stillOwedByA, 'a withdrawn client must not still owe for the class').toBe(0)

    // 2. B has the seat now, so B must owe for it.
    const promoted = await prisma.classEnrollment.findFirstOrThrow({ where: { id: rowB.id } })
    expect(promoted.status, 'B is promoted into the free seat').toBe('ENROLLED')
    const owedByB = await prisma.invoice.count({
      where: { clientId: b.clientId, sourceType: 'CLASS_ENROLLMENT', status: 'UNPAID' },
    })
    expect(owedByB, 'a client promoted off the waitlist has to be billed').toBe(1)
  } finally {
    for (const m of made) {
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId: m.clientId } } }).catch(() => {})
      await prisma.invoice.deleteMany({ where: { clientId: m.clientId } }).catch(() => {})
      await prisma.classEnrollment.deleteMany({ where: { clientId: m.clientId } }).catch(() => {})
      await prisma.clientProfile.updateMany({ where: { id: m.clientId }, data: { dogId: null } }).catch(() => {})
      await prisma.clientProfile.deleteMany({ where: { id: m.clientId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: m.dogId } }).catch(() => {})
      await prisma.account.deleteMany({ where: { userId: m.userId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: m.userId } }).catch(() => {})
    }
    if (packageId) {
      await prisma.classRun.deleteMany({ where: { packageId } }).catch(() => {})
      await prisma.package.delete({ where: { id: packageId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

test('deleting a membership cannot quietly take away what people already bought', async ({ page }) => {
  // The confirm dialog promises "Anyone who already bought it keeps what it gave
  // them." MembershipPurchase.membership is onDelete: Cascade, so the delete
  // takes every purchase row with it — including ACTIVE ones carrying a live
  // Stripe subscription id, which keeps billing with nothing left behind it.
  test.setTimeout(120_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let membershipId = ''
  let clientIds: { userId: string; dogId: string; clientId: string } | null = null
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    clientIds = await makeClient(prisma, trainer.id, `${tag}m`)

    const membership = await prisma.membership.create({
      data: { trainerId: trainer.id, name: `Money audit membership ${tag}`, priceCents: 9900, published: true },
    })
    membershipId = membership.id

    // Someone is on it, and being charged for it.
    await prisma.membershipPurchase.create({
      data: {
        membershipId: membership.id,
        trainerId: trainer.id,
        clientId: clientIds.clientId,
        status: 'ACTIVE',
        stripeSubscriptionId: `sub_audit_${tag}`,
      },
    })

    const res = await page.request.delete(`/api/trainer/memberships/${membership.id}`)

    // Either it refuses, or it keeps the promise. What it must NOT do is say ok
    // and delete the record of what someone paid for.
    const survived = await prisma.membershipPurchase.count({ where: { membershipId: membership.id } })
    expect(
      survived,
      'a purchase — with a live Stripe subscription on it — must survive the offering being deleted',
    ).toBe(1)
    expect(res.status(), 'and the API should say why it refused').toBe(409)
  } finally {
    if (membershipId) {
      await prisma.membershipPurchase.deleteMany({ where: { membershipId } }).catch(() => {})
      await prisma.membership.delete({ where: { id: membershipId } }).catch(() => {})
    }
    if (clientIds) {
      await prisma.clientProfile.updateMany({ where: { id: clientIds.clientId }, data: { dogId: null } }).catch(() => {})
      await prisma.clientProfile.deleteMany({ where: { id: clientIds.clientId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: clientIds.dogId } }).catch(() => {})
      await prisma.account.deleteMany({ where: { userId: clientIds.userId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: clientIds.userId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

test('cancelling a whole class does not leave everyone on it still owing', async ({ page }) => {
  // Deleting a run tells every client "This class has been cancelled" and
  // cascades their enrolments away — taking with them the only link back to the
  // invoices those enrolments raised. The bill stayed (audit T-6).
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let packageId = ''
  let client: { userId: string; dogId: string; clientId: string } | null = null
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    client = await makeClient(prisma, trainer.id, `${tag}c`)

    const created = await page.request.post('/api/packages', {
      data: {
        name: `Money audit cancel ${tag}`, sessionCount: 3, weeksBetween: 1, durationMins: 60,
        isGroup: true, capacity: 6, priceCents: 18000,
        startAt: new Date(Date.now() + 28 * 864e5).toISOString(),
      },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    packageId = (await created.json()).id
    const run = await prisma.classRun.findFirstOrThrow({ where: { packageId } })

    const enrol = await page.request.post(`/api/class-runs/${run.id}/enrollments`, {
      data: { clientId: client.clientId, dogId: client.dogId },
    })
    expect(enrol.status(), await enrol.text()).toBeLessThan(300)
    expect(
      await prisma.invoice.count({ where: { clientId: client.clientId, status: 'UNPAID' } }),
      'enrolling bills them',
    ).toBe(1)

    const killed = await page.request.delete(`/api/class-runs/${run.id}`)
    expect(killed.status(), await killed.text()).toBe(200)

    const stillOwed = await prisma.invoice.count({
      where: { clientId: client.clientId, sourceType: 'CLASS_ENROLLMENT', status: { not: 'CANCELLED' } },
    })
    expect(stillOwed, 'the class was cancelled, so nobody may still owe for it').toBe(0)
  } finally {
    if (client) {
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId: client.clientId } } }).catch(() => {})
      await prisma.invoice.deleteMany({ where: { clientId: client.clientId } }).catch(() => {})
      await prisma.clientProfile.updateMany({ where: { id: client.clientId }, data: { dogId: null } }).catch(() => {})
      await prisma.clientProfile.deleteMany({ where: { id: client.clientId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: client.dogId } }).catch(() => {})
      await prisma.account.deleteMany({ where: { userId: client.userId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: client.userId } }).catch(() => {})
    }
    if (packageId) {
      await prisma.classRun.deleteMany({ where: { packageId } }).catch(() => {})
      await prisma.package.delete({ where: { id: packageId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

test('a product with orders or invoices behind it cannot be deleted away', async ({ page }) => {
  // ProductRequest.product is onDelete: Cascade, so deleting a product used to
  // take every order with it — the ones clients were waiting on and the
  // fulfilled ones that are the record of what somebody bought — while their
  // invoices survived, owed, pointing at rows that no longer existed (T-7).
  test.setTimeout(120_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let productId = ''
  let client: { userId: string; dogId: string; clientId: string } | null = null
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    client = await makeClient(prisma, trainer.id, `${tag}p`)

    const made = await page.request.post('/api/products', {
      data: { name: `Money audit product ${tag}`, priceCents: 3500, stockCount: 5 },
    })
    expect(made.status(), await made.text()).toBeLessThan(300)
    productId = (await made.json()).id

    await prisma.productRequest.create({
      data: { clientId: client.clientId, productId, status: 'PENDING' },
    })

    const refused = await page.request.delete(`/api/products/${productId}`)
    expect(refused.status(), 'a product on order must not be deletable').toBe(409)
    expect(
      await prisma.productRequest.count({ where: { productId } }),
      'and the order must still be there',
    ).toBe(1)

    // Once nobody is waiting on it and nothing was billed, it goes.
    await prisma.productRequest.deleteMany({ where: { productId } })
    const gone = await page.request.delete(`/api/products/${productId}`)
    expect(gone.status(), await gone.text()).toBe(200)
    productId = ''
  } finally {
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {})
    if (client) {
      await prisma.productRequest.deleteMany({ where: { clientId: client.clientId } }).catch(() => {})
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId: client.clientId } } }).catch(() => {})
      await prisma.invoice.deleteMany({ where: { clientId: client.clientId } }).catch(() => {})
      await prisma.clientProfile.updateMany({ where: { id: client.clientId }, data: { dogId: null } }).catch(() => {})
      await prisma.clientProfile.deleteMany({ where: { id: client.clientId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: client.dogId } }).catch(() => {})
      await prisma.account.deleteMany({ where: { userId: client.userId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: client.userId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})

test('a session form that has been filled in cannot be deleted away', async ({ page }) => {
  // SessionFormResponse.form is onDelete: Cascade, so deleting a session form
  // took every answer ever recorded on it — the trainer's record of what was
  // captured at each session, and what was sent to the client (audit T-8).
  test.setTimeout(120_000)
  const prisma = await makePrisma()
  const tag = Date.now().toString(36)
  let formId = ''
  let sessionId = ''
  let client: { userId: string; dogId: string; clientId: string } | null = null
  try {
    await login(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    client = await makeClient(prisma, trainer.id, `${tag}f`)

    const form = await prisma.sessionForm.create({
      data: {
        trainerId: trainer.id, name: `Audit session form ${tag}`, isActive: true,
        questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'How did it go?', required: false }],
      },
    })
    formId = form.id

    // An empty one deletes, exactly as before.
    const spare = await prisma.sessionForm.create({
      data: { trainerId: trainer.id, name: `Audit spare form ${tag}`, isActive: true, questions: [] },
    })
    const emptyGone = await page.request.delete(`/api/session-forms/${spare.id}`)
    expect(emptyGone.status(), 'a form nobody has filled in still deletes').toBe(200)

    // Now record an answer against the real one.
    const session = await prisma.trainingSession.create({
      data: {
        trainerId: trainer.id, clientId: client.clientId, dogId: client.dogId,
        title: `Audit session ${tag}`,
        scheduledAt: new Date(Date.now() - 864e5), durationMins: 60, status: 'COMPLETED',
      },
    })
    sessionId = session.id
    await prisma.sessionFormResponse.create({
      data: { sessionId: session.id, formId: form.id, answers: { q1: 'Went really well' } },
    })

    const refused = await page.request.delete(`/api/session-forms/${form.id}`)
    expect(refused.status(), 'a form with answers on it must not be deletable').toBe(409)
    expect(
      await prisma.sessionFormResponse.count({ where: { formId: form.id } }),
      'and the answers must still be there',
    ).toBe(1)
  } finally {
    if (sessionId) {
      await prisma.sessionFormResponse.deleteMany({ where: { sessionId } }).catch(() => {})
      await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
    }
    if (formId) await prisma.sessionForm.delete({ where: { id: formId } }).catch(() => {})
    if (client) {
      await prisma.trainingSession.deleteMany({ where: { clientId: client.clientId } }).catch(() => {})
      await prisma.clientProfile.updateMany({ where: { id: client.clientId }, data: { dogId: null } }).catch(() => {})
      await prisma.clientProfile.deleteMany({ where: { id: client.clientId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { id: client.dogId } }).catch(() => {})
      await prisma.account.deleteMany({ where: { userId: client.userId } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: client.userId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})
