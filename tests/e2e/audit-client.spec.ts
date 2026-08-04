/**
 * CLIENT-SIDE AUDIT — the guards that matter most, and the bugs the audit found.
 *
 * Companion to `docs/audit-client.md`. Two kinds of test in here:
 *
 *   1. LEAK GUARDS — assert a dog owner CANNOT see something. These are the
 *      failures nobody notices by hand: a private note, an unsent write-up,
 *      another client's session, another trainer's homework, an offering the
 *      trainer hasn't opened yet. Every one plants a sentinel string in the
 *      data and asserts it is absent from the page's whole HTML (not just its
 *      visible text — the RSC payload counts as "sent to the browser").
 *
 *   2. KNOWN BUGS — reproduced with the CORRECT expectation, so they fail the
 *      day they're fixed rather than the day they're found. Marked test.fail()
 *      with the finding number from docs/audit-client.md.
 *
 * Everything is created and torn down by the test itself, so global-setup.ts
 * (and every other spec's counts) is untouched.
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { SEED, TEST_DATABASE_URL } from './test-db'

// ─── sentinels: if any of these reaches the browser, something has leaked ────
const S = {
  PRIVATE_NOTE: 'AUDITLEAK-PRIVATE-TRAINER-ONLY-NOTE',
  PUBLIC_NOTE: 'AUDITSEEN-what-we-worked-on-today',
  DRAFT_NOTE: 'AUDITLEAK-UNSENT-DRAFT-NOTE',
  OTHER_CLIENT_NOTE: 'AUDITLEAK-ANOTHER-CLIENTS-NOTE',
  OTHER_TRAINER_HOMEWORK: 'AUDITLEAK-OTHER-TRAINER-HOMEWORK',
  AFTER_HOMEWORK: 'AUDITLEAK-AFTER-SESSION-HOMEWORK',
  BEFORE_HOMEWORK: 'AUDITSEEN-BEFORE-SESSION-HOMEWORK',
  HIDDEN_OFFERING: 'AUDITLEAK-NOT-YET-VISIBLE-CLASS',
  HIDDEN_PRODUCT: 'AUDITLEAK-INACTIVE-PRODUCT',
}

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

const inDays = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * 864e5)
  d.setHours(hour, 0, 0, 0)
  return d
}

type Prisma = Awaited<ReturnType<typeof makePrisma>>

/** The password every audit-owned login uses. */
const AUDIT_PASSWORD = 'Password123!'

/**
 * A throwaway dog owner on the given business, with a dog, a phone (the
 * client layout's gate wants one) and a credentials login so the browser can
 * actually sign in as them.
 */
async function makeAuditClient(prisma: Prisma, trainerId: string, tag: string) {
  const email = `audit-client-${tag}@e2e.test`
  const hash = await bcrypt.hash(AUDIT_PASSWORD, 12)
  const user = await prisma.user.create({
    data: {
      email, name: 'Audit Owner', role: 'CLIENT', emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const dog = await prisma.dog.create({ data: { name: `Audit Dog ${tag}` } })
  const client = await prisma.clientProfile.create({
    data: { userId: user.id, trainerId, dogId: dog.id, status: 'ACTIVE', phone: '+6421000123' },
  })
  const cleanupClient = async () => {
    const profiles = await prisma.clientProfile.findMany({ where: { userId: user.id }, select: { id: true } })
    const ids = profiles.map(p => p.id)
    await prisma.trainingLog.deleteMany({ where: { task: { clientId: { in: ids } } } })
    await prisma.trainingTask.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.productRequest.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.classEnrollment.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId: { in: ids } } } })
    await prisma.invoice.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.stockMovement.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.trainingSession.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.customFieldValue.deleteMany({ where: { clientId: { in: ids } } })
    await prisma.clientProfile.updateMany({ where: { id: { in: ids } }, data: { dogId: null } })
    await prisma.dog.deleteMany({ where: { OR: [{ id: dog.id }, { clientProfileId: { in: ids } }] } })
    await prisma.clientProfile.deleteMany({ where: { id: { in: ids } } })
    await prisma.account.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
  return { user, dog, client, cleanupClient }
}

/** Sign in as a fixture's own dog owner and pin the business under audit. */
async function loginAsAuditClient(page: Page, prisma: Prisma, clientId: string) {
  const profile = await prisma.clientProfile.findUniqueOrThrow({
    where: { id: clientId }, select: { user: { select: { email: true } } },
  })
  await login(page, profile.user.email!, AUDIT_PASSWORD)
  await page.context().addCookies([
    { name: 'pm-active-trainer', value: clientId, domain: 'localhost', path: '/' },
  ])
}

interface Fixture {
  trainerId: string
  businessBId: string
  clientId: string
  clientUserId: string
  otherClientId: string
  clientBProfileId: string
  sessionFormId: string
  doneSessionId: string
  draftSessionId: string
  upcomingSessionId: string
  otherClientSessionId: string
  trainerBSessionId: string
  hiddenRunId: string
  hiddenPackageId: string
  hiddenProductId: string
  intakeFormId: string
  cleanup: () => Promise<void>
}

/**
 * One trainer-side set-up, exactly as a real trainer's account would look:
 * a write-up form with a team-only question, a session that has happened and
 * been marked done, one that has happened and hasn't, homework on both sides
 * of "before"/"after", a class the trainer hasn't opened yet, and a product
 * they've hidden. Plus somebody else's data to try and reach.
 */
async function build(prisma: Prisma): Promise<Fixture> {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
  const businessB = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.businessB.ownerEmail } } })
  const made: Array<() => Promise<unknown>> = []

  // ── this spec's OWN dog owner ─────────────────────────────────────────────
  // Deliberately NOT SEED.client. This suite runs serially against one shared
  // database, and every spec after this one that opens the client app as the
  // seeded owner would inherit whatever we did to them — a second business on
  // their account is enough to change which trainer the app opens on. So the
  // audit brings its own person and takes them away again.
  const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, tag)
  made.push(cleanupClient)

  const form = await prisma.sessionForm.create({
    data: {
      trainerId: trainer.id, name: `Audit write-up ${tag}`,
      questions: [
        { id: 'q_public', type: 'LONG_TEXT', label: 'What we worked on', required: false },
        { id: 'q_private', type: 'LONG_TEXT', label: 'Team-only note', required: false, isPrivate: true },
      ],
    },
  })
  made.push(() => prisma.sessionForm.delete({ where: { id: form.id } }))

  // A session the trainer HAS marked done — its write-up is published…
  const done = await prisma.trainingSession.create({
    data: { trainerId: trainer.id, clientId: client.id, dogId: client.dogId, title: `Audit done ${tag}`, scheduledAt: inDays(-7), status: 'COMPLETED' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: done.id, formId: form.id, answers: { q_public: S.PUBLIC_NOTE, q_private: S.PRIVATE_NOTE } },
  })
  // …and one that has HAPPENED but has not been ticked off. Its write-up is
  // the trainer's private draft until they say otherwise.
  const draft = await prisma.trainingSession.create({
    data: { trainerId: trainer.id, clientId: client.id, dogId: client.dogId, title: `Audit draft ${tag}`, scheduledAt: inDays(-2), status: 'UPCOMING' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: draft.id, formId: form.id, answers: { q_public: S.DRAFT_NOTE }, sentAt: null },
  })
  // An upcoming session carrying homework on both sides of the lesson.
  const upcoming = await prisma.trainingSession.create({
    data: { trainerId: trainer.id, clientId: client.id, dogId: client.dogId, title: `Audit upcoming ${tag}`, scheduledAt: inDays(3), status: 'UPCOMING' },
  })
  await prisma.trainingTask.create({
    data: { clientId: client.id, sessionId: upcoming.id, date: inDays(3), timing: 'BEFORE_SESSION', title: S.BEFORE_HOMEWORK },
  })
  await prisma.trainingTask.create({
    data: { clientId: client.id, sessionId: upcoming.id, date: inDays(3), timing: 'AFTER_SESSION', title: S.AFTER_HOMEWORK },
  })
  made.push(async () => {
    await prisma.trainingTask.deleteMany({ where: { sessionId: { in: [upcoming.id] } } })
    await prisma.sessionFormResponse.deleteMany({ where: { sessionId: { in: [done.id, draft.id] } } })
    await prisma.trainingSession.deleteMany({ where: { id: { in: [done.id, draft.id, upcoming.id] } } })
  })

  // ── someone ELSE's session, on the same business ──────────────────────────
  const otherSession = await prisma.trainingSession.create({
    data: { trainerId: trainer.id, clientId: SEED.unassignedClientId, title: `Audit other ${tag}`, scheduledAt: inDays(-4), status: 'COMPLETED' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: otherSession.id, formId: form.id, answers: { q_public: S.OTHER_CLIENT_NOTE }, sentAt: new Date() },
  })
  made.push(async () => {
    await prisma.sessionFormResponse.deleteMany({ where: { sessionId: otherSession.id } })
    await prisma.trainingSession.delete({ where: { id: otherSession.id } })
  })

  // ── the SAME person, a client of business B as well ───────────────────────
  const bProfile = await prisma.clientProfile.create({
    data: { userId: client.userId, trainerId: businessB.id, status: 'ACTIVE', phone: '+6421000009' },
  })
  const bSession = await prisma.trainingSession.create({
    data: { trainerId: businessB.id, clientId: bProfile.id, title: `Audit rival ${tag}`, scheduledAt: inDays(-3), status: 'COMPLETED' },
  })
  await prisma.trainingTask.create({
    data: { clientId: bProfile.id, sessionId: bSession.id, date: inDays(-3), timing: 'AFTER_SESSION', title: S.OTHER_TRAINER_HOMEWORK },
  })
  made.push(async () => {
    await prisma.trainingTask.deleteMany({ where: { clientId: bProfile.id } })
    await prisma.trainingSession.deleteMany({ where: { id: bSession.id } })
    await prisma.clientProfile.delete({ where: { id: bProfile.id } })
  })

  // ── an offering the trainer has built but not opened yet ──────────────────
  const hiddenPkg = await prisma.package.create({
    data: {
      trainerId: trainer.id, name: S.HIDDEN_OFFERING, isGroup: true, sessionCount: 1,
      capacity: 5, priceCents: 0, publicEnrollment: true, clientSelfBook: true,
      selfBookRequiresApproval: false, visibleFrom: inDays(60),
    },
  })
  const hiddenRun = await prisma.classRun.create({
    data: { trainerId: trainer.id, packageId: hiddenPkg.id, name: `${S.HIDDEN_OFFERING} run`, startDate: inDays(70), capacity: 5 },
  })
  await prisma.trainingSession.create({
    data: { trainerId: trainer.id, classRunId: hiddenRun.id, sessionIndex: 1, title: 'Hidden s1', scheduledAt: inDays(70, 18) },
  })
  made.push(async () => {
    await prisma.classEnrollment.deleteMany({ where: { classRunId: hiddenRun.id } })
    await prisma.trainingSession.deleteMany({ where: { classRunId: hiddenRun.id } })
    await prisma.classRun.delete({ where: { id: hiddenRun.id } })
    await prisma.package.delete({ where: { id: hiddenPkg.id } })
  })

  // ── a product the trainer has hidden from the shop ────────────────────────
  const hiddenProduct = await prisma.product.create({
    data: { trainerId: trainer.id, name: S.HIDDEN_PRODUCT, priceCents: 999, stockCount: 5, active: false },
  })
  made.push(async () => {
    await prisma.productRequest.deleteMany({ where: { productId: hiddenProduct.id } })
    await prisma.product.delete({ where: { id: hiddenProduct.id } })
  })

  // ── an intake form that asks for an address (finding C-1) ─────────────────
  const intake = await prisma.form.create({
    data: {
      trainerId: trainer.id, name: `Audit intake ${tag}`, usableAsIntake: true, isActive: true,
      questions: [
        { id: 'i_challenge', type: 'SHORT_TEXT', label: 'Biggest challenge', required: true },
        { id: 'i_address', type: 'CLIENT_FIELD', fieldKey: 'address', required: true },
      ],
      steps: [],
    },
  })
  made.push(async () => {
    await prisma.clientProfile.updateMany({ where: { intakeFormId: intake.id }, data: { intakeFormId: null } })
    await prisma.form.delete({ where: { id: intake.id } })
  })

  return {
    trainerId: trainer.id, businessBId: businessB.id,
    clientId: client.id, clientUserId: client.userId, otherClientId: SEED.unassignedClientId,
    clientBProfileId: bProfile.id, sessionFormId: form.id,
    doneSessionId: done.id, draftSessionId: draft.id, upcomingSessionId: upcoming.id,
    otherClientSessionId: otherSession.id, trainerBSessionId: bSession.id,
    hiddenRunId: hiddenRun.id, hiddenPackageId: hiddenPkg.id, hiddenProductId: hiddenProduct.id,
    intakeFormId: intake.id,
    cleanup: async () => { for (const fn of made.reverse()) await fn().catch(() => {}) },
  }
}

test.describe('client audit — leak guards', () => {
  test('a dog owner never receives a team-only answer, an unsent draft, another client’s write-up, or another trainer’s work', async ({ page }) => {
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    try {
      fx = await build(prisma)

      await loginAsAuditClient(page, prisma, fx.clientId)

      // ── the published write-up: they see the public half, never the private ──
      await page.goto(`/my-sessions/${fx.doneSessionId}`)
      const doneHtml = await page.content()
      expect(doneHtml, 'the published answer should reach the client').toContain(S.PUBLIC_NOTE)
      expect(doneHtml, 'a team-only answer must never reach the client').not.toContain(S.PRIVATE_NOTE)

      // ── the unsent draft on a session nobody ticked off ──────────────────────
      await page.goto(`/my-sessions/${fx.draftSessionId}`)
      expect(await page.content(), 'an unsent draft must not be visible').not.toContain(S.DRAFT_NOTE)

      // ── somebody else's session, by id ───────────────────────────────────────
      await page.goto(`/my-sessions/${fx.otherClientSessionId}`)
      expect(await page.content(), 'another client’s write-up must not be readable').not.toContain(S.OTHER_CLIENT_NOTE)

      // ── the other business's session, for the SAME person ────────────────────
      await page.goto(`/my-sessions/${fx.trainerBSessionId}`)
      const rivalHtml = await page.content()
      expect(rivalHtml, 'the other business’s homework must not appear here').not.toContain(S.OTHER_TRAINER_HOMEWORK)

      // ── and none of it on the pages they actually live on ────────────────────
      for (const path of ['/home', '/my-sessions']) {
        await page.goto(path)
        const html = await page.content()
        expect(html, `${path} leaked a private answer`).not.toContain(S.PRIVATE_NOTE)
        expect(html, `${path} leaked an unsent draft`).not.toContain(S.DRAFT_NOTE)
        expect(html, `${path} leaked another client’s note`).not.toContain(S.OTHER_CLIENT_NOTE)
        expect(html, `${path} leaked the other business’s homework`).not.toContain(S.OTHER_TRAINER_HOMEWORK)
      }
    } finally {
      await fx?.cleanup()
      await prisma.$disconnect()
    }
  })

  test('homework set for AFTER the session stays hidden until the session has run', async ({ page }) => {
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    try {
      fx = await build(prisma)
      await loginAsAuditClient(page, prisma, fx.clientId)

      await page.goto(`/my-sessions/${fx.upcomingSessionId}`)
      const html = await page.content()
      expect(html, 'preparation homework should be readable straight away').toContain(S.BEFORE_HOMEWORK)
      expect(html, 'practice homework must wait for the session to run').not.toContain(S.AFTER_HOMEWORK)

      await page.goto('/home')
      expect(await page.content(), 'the home screen leaked after-session homework').not.toContain(S.AFTER_HOMEWORK)

      // …and it appears the moment the trainer marks the session done.
      await prisma.trainingSession.update({ where: { id: fx.upcomingSessionId }, data: { status: 'COMPLETED' } })
      await page.goto(`/my-sessions/${fx.upcomingSessionId}`)
      expect(await page.content(), 'once the session is done the practice should show').toContain(S.AFTER_HOMEWORK)
    } finally {
      await fx?.cleanup()
      await prisma.$disconnect()
    }
  })

  test('an offering the trainer has not opened yet cannot be seen or booked, even by direct URL', async ({ page }) => {
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    try {
      fx = await build(prisma)
      await loginAsAuditClient(page, prisma, fx.clientId)

      await page.goto('/my-availability')
      expect(await page.content(), 'a not-yet-showing offering must not be sent to the browser').not.toContain(S.HIDDEN_OFFERING)

      const enrol = await page.request.post(`/api/my/classes/${fx.hiddenRunId}/enroll`, { data: { type: 'FULL' } })
      expect(enrol.status(), 'enrolling in a hidden run should be refused').toBe(404)

      const selfBook = await page.request.post('/api/my/self-book', {
        data: { packageId: fx.hiddenPackageId, startDate: inDays(65).toISOString() },
      })
      expect(selfBook.status(), 'self-booking a hidden offering should be refused').toBe(404)

      const waitlist = await page.request.post('/api/my/waitlist', { data: { packageId: fx.hiddenPackageId } })
      expect(waitlist.status(), 'waitlisting a hidden offering should be refused').toBeGreaterThanOrEqual(400)

      const enrolled = await prisma.classEnrollment.count({ where: { classRunId: fx.hiddenRunId } })
      expect(enrolled, 'nothing should have been booked onto the hidden run').toBe(0)
    } finally {
      await fx?.cleanup()
      await prisma.$disconnect()
    }
  })

  test('a product the trainer has hidden cannot be bought or requested', async ({ page }) => {
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    try {
      fx = await build(prisma)
      await loginAsAuditClient(page, prisma, fx.clientId)

      await page.goto('/my-shop')
      expect(await page.content(), 'an inactive product must not reach the shop').not.toContain(S.HIDDEN_PRODUCT)

      const req = await page.request.post(`/api/my/products/${fx.hiddenProductId}/request`, { data: {} })
      expect(req.status(), 'requesting a hidden product should 404').toBe(404)

      const basket = await page.request.post('/api/my/basket/checkout', {
        data: { lines: [{ kind: 'PRODUCT', key: 'x', productId: fx.hiddenProductId, quantity: 1 }] },
      })
      expect(basket.status(), 'a hidden product must not be checkout-able').toBeGreaterThanOrEqual(400)

      expect(await prisma.productRequest.count({ where: { productId: fx.hiddenProductId } })).toBe(0)
    } finally {
      await fx?.cleanup()
      await prisma.$disconnect()
    }
  })
})

test.describe('client audit — known bugs (docs/audit-client.md)', () => {
  // ── C-1 ────────────────────────────────────────────────────────────────────
  test('C-1 · an intake form that asks for an Address can be submitted', async ({ page }) => {
    // ClientProfile has addressLine, not address. Mapping the answer to `address`
    // threw at Prisma, 500d the submit and left the client stuck behind the gate
    // with no way past it. Fixed 2026-08-04.
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    try {
      fx = await build(prisma)
      await prisma.clientProfile.update({
        where: { id: fx.clientId },
        data: { intakeFormId: fx.intakeFormId, intakeCompletedAt: null },
      })
      await loginAsAuditClient(page, prisma, fx.clientId)
      const res = await page.request.post('/api/my/intake-form/submit', {
        data: {
          formId: fx.intakeFormId,
          answers: { i_challenge: 'Pulls on the lead', i_address: '12 Queen Street, Auckland' },
        },
      })
      expect(res.status(), await res.text()).toBe(200)

      // And the answer has to BE their address, not just a row in the answer blob.
      const after = await prisma.clientProfile.findUnique({
        where: { id: fx.clientId },
        select: { addressLine: true, intakeCompletedAt: true },
      })
      expect(after?.addressLine).toBe('12 Queen Street, Auckland')
      expect(after?.intakeCompletedAt).not.toBeNull()
    } finally {
      await fx?.cleanup()
      await prisma.$disconnect()
    }
  })

  // ── C-2 ────────────────────────────────────────────────────────────────────
  test('C-2 · an intake with every required answer left blank is refused', async ({ page }) => {
    // The submit route never checked `required` — an empty intake was accepted,
    // the gate lifted, and the trainer's screen said the client had filled it in.
    // Fixed 2026-08-04.
    const prisma = await makePrisma()
    let fx: Fixture | null = null
    let formId: string | null = null
    try {
      fx = await build(prisma)
      // A form with no address question, so this test fails for the required
      // check and nothing else.
      const form = await prisma.form.create({
        data: {
          trainerId: fx.trainerId, name: `Audit required ${Date.now()}`, usableAsIntake: true, isActive: true,
          questions: [{ id: 'r_1', type: 'SHORT_TEXT', label: 'Biggest challenge', required: true }],
          steps: [],
        },
      })
      formId = form.id
      await prisma.clientProfile.update({
        where: { id: fx.clientId }, data: { intakeFormId: form.id, intakeCompletedAt: null },
      })
      await loginAsAuditClient(page, prisma, fx.clientId)
      const res = await page.request.post('/api/my/intake-form/submit', {
        data: { formId: form.id, answers: { r_1: '' } },
      })
      expect(res.status(), 'a blank required answer should be refused').toBe(400)

      const after = await prisma.clientProfile.findUniqueOrThrow({ where: { id: fx.clientId } })
      expect(after.intakeCompletedAt, 'an empty intake must not lift the gate').toBeNull()

      // Answered properly it goes through, and the gate lifts.
      const good = await page.request.post('/api/my/intake-form/submit', {
        data: { formId: form.id, answers: { r_1: 'Pulls on the lead' } },
      })
      expect(good.status(), await good.text()).toBe(200)

      // And a second post can't come back and wipe those answers.
      const again = await page.request.post('/api/my/intake-form/submit', {
        data: { formId: form.id, answers: {} },
      })
      expect(again.status(), 'a completed intake must not be re-submitted').toBe(409)
      const kept = await prisma.clientProfile.findUniqueOrThrow({ where: { id: fx.clientId } })
      expect(JSON.stringify(kept.intakeAnswers)).toContain('Pulls on the lead')
    } finally {
      await fx?.cleanup()
      if (formId) await prisma.form.delete({ where: { id: formId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // ── C-3 ────────────────────────────────────────────────────────────────────
  test('C-3 · cancelling a product request cancels the money and puts the stock back', async ({ page }) => {
    // Cancelling used to delete the request row and nothing else — the
    // receivable stood and the stock stayed spent. Fixed 2026-08-04.
    const prisma = await makePrisma()
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
    let productId: string | null = null
    let dropClient: (() => Promise<void>) | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
      const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, tag)
      dropClient = cleanupClient
      const clientId = client.id
      const product = await prisma.product.create({
        data: { trainerId: trainer.id, name: `Audit cancel ${tag}`, priceCents: 2500, stockCount: 4, active: true },
      })
      productId = product.id

      await loginAsAuditClient(page, prisma, clientId)

      const made = await page.request.post(`/api/my/products/${product.id}/request`, { data: {} })
      expect(made.status()).toBe(201)

      const dropped = await page.request.delete(`/api/my/products/${product.id}/request`)
      expect(dropped.status()).toBe(200)

      const stillOwed = await prisma.invoice.count({
        where: { clientId, sourceType: 'PRODUCT', sourceId: product.id, status: { not: 'CANCELLED' } },
      })
      expect(stillOwed, 'a cancelled request must not leave an invoice behind').toBe(0)

      const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(after.stockCount, 'the item should be back on the shelf').toBe(4)

      // And ordering it again has to bill again — the cancelled invoice must not
      // stand in for a live one, or the second order is free.
      const again = await page.request.post(`/api/my/products/${product.id}/request`, { data: {} })
      expect(again.status()).toBe(201)
      const owedNow = await prisma.invoice.count({
        where: { clientId, sourceType: 'PRODUCT', sourceId: product.id, status: 'UNPAID' },
      })
      expect(owedNow, 'a re-order raises a fresh receivable').toBe(1)
    } finally {
      await dropClient?.().catch(() => {})
      if (productId) {
        await prisma.invoiceLineItem.deleteMany({ where: { invoice: { sourceId: productId } } }).catch(() => {})
        await prisma.invoice.deleteMany({ where: { sourceType: 'PRODUCT', sourceId: productId } }).catch(() => {})
        await prisma.stockMovement.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Booking and buying — the journeys a client's money and diary depend on.
//
// Everything here is FREE (or unpriced), because a priced offering on a
// payments-enabled trainer hands off to Stripe and there is nothing to assert
// on this side of the redirect. The guards being tested — capacity, a date
// that has been and gone, a seat already held, a ticket type's own cap, an
// empty shelf — are the same either way; only the last step differs.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('client audit — booking and buying', () => {
  test('books a class, several casual dates at once and an event ticket — and is refused a full, finished or past one', async ({ page }) => {
    const prisma = await makePrisma()
    const tag = Date.now().toString(36)
    const bin: Array<() => Promise<unknown>> = []
    try {
      const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
      const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, tag)
      const clientId = client.id
      bin.push(cleanupClient)

      // ── a free group class, 3 weekly sessions ────────────────────────────
      const coursePkg = await prisma.package.create({
        data: { trainerId: trainer.id, name: `Audit course ${tag}`, isGroup: true, sessionCount: 3, weeksBetween: 1, capacity: 6, priceCents: null, requirePayment: false },
      })
      const courseRun = await prisma.classRun.create({
        data: { trainerId: trainer.id, packageId: coursePkg.id, name: `Audit course run ${tag}`, startDate: inDays(7), capacity: 6 },
      })
      for (let i = 0; i < 3; i++) {
        await prisma.trainingSession.create({
          data: { trainerId: trainer.id, classRunId: courseRun.id, sessionIndex: i + 1, title: `Course s${i + 1}`, scheduledAt: inDays(7 + i * 7, 18) },
        })
      }

      // ── a free casual class: four dates ahead, one behind ────────────────
      const dropPkg = await prisma.package.create({
        data: { trainerId: trainer.id, name: `Audit casual ${tag}`, isGroup: true, allowDropIn: true, dropInPriceCents: null, sessionCount: 0, capacity: 8, requirePayment: false },
      })
      const dropRun = await prisma.classRun.create({
        data: { trainerId: trainer.id, packageId: dropPkg.id, name: `Audit casual run ${tag}`, startDate: inDays(2), capacity: 8 },
      })
      const future: string[] = []
      for (let i = 0; i < 4; i++) {
        const s = await prisma.trainingSession.create({
          data: { trainerId: trainer.id, classRunId: dropRun.id, sessionIndex: i + 1, title: `Casual ${i + 1}`, scheduledAt: inDays(2 + i * 7, 15) },
        })
        future.push(s.id)
      }
      const past = await prisma.trainingSession.create({
        data: { trainerId: trainer.id, classRunId: dropRun.id, sessionIndex: 0, title: 'Casual (gone)', scheduledAt: inDays(-5, 15) },
      })

      // ── a free event that sells two ticket types, one capped at 2 ────────
      const eventPkg = await prisma.package.create({
        data: { trainerId: trainer.id, name: `Audit event ${tag}`, isGroup: true, isEvent: true, sessionCount: 1, capacity: 20, requirePayment: false },
      })
      const early = await prisma.packageTicketTier.create({ data: { packageId: eventPkg.id, name: 'Early bird', priceCents: null, capacity: 2, order: 0 } })
      const general = await prisma.packageTicketTier.create({ data: { packageId: eventPkg.id, name: 'General', priceCents: null, capacity: 10, order: 1 } })
      const eventRun = await prisma.classRun.create({
        data: { trainerId: trainer.id, packageId: eventPkg.id, name: `Audit event run ${tag}`, startDate: inDays(14), capacity: 20 },
      })
      await prisma.trainingSession.create({
        data: { trainerId: trainer.id, classRunId: eventRun.id, sessionIndex: 1, title: 'The event', scheduledAt: inDays(14, 9) },
      })

      // ── a class with ONE seat, already taken by somebody else ────────────
      const fullPkg = await prisma.package.create({
        data: { trainerId: trainer.id, name: `Audit full ${tag}`, isGroup: true, sessionCount: 1, capacity: 1, requirePayment: false },
      })
      const fullRun = await prisma.classRun.create({
        data: { trainerId: trainer.id, packageId: fullPkg.id, name: `Audit full run ${tag}`, startDate: inDays(10), capacity: 1 },
      })
      await prisma.trainingSession.create({
        data: { trainerId: trainer.id, classRunId: fullRun.id, sessionIndex: 1, title: 'Only seat', scheduledAt: inDays(10, 18) },
      })
      await prisma.classEnrollment.create({
        data: { classRunId: fullRun.id, clientId: SEED.unassignedClientId, type: 'FULL', status: 'ENROLLED' },
      })

      // ── a course that has finished ───────────────────────────────────────
      const donePkg = await prisma.package.create({
        data: { trainerId: trainer.id, name: `Audit finished ${tag}`, isGroup: true, sessionCount: 1, capacity: 5, requirePayment: false },
      })
      const doneRun = await prisma.classRun.create({
        data: { trainerId: trainer.id, packageId: donePkg.id, name: `Audit finished run ${tag}`, startDate: inDays(-30), capacity: 5, status: 'COMPLETED' },
      })

      bin.push(async () => {
        for (const runId of [courseRun.id, dropRun.id, eventRun.id, fullRun.id, doneRun.id]) {
          await prisma.classEnrollment.deleteMany({ where: { classRunId: runId } })
          await prisma.trainingSession.deleteMany({ where: { classRunId: runId } })
          await prisma.classRun.delete({ where: { id: runId } }).catch(() => {})
        }
        await prisma.packageTicketTier.deleteMany({ where: { packageId: eventPkg.id } })
        for (const id of [coursePkg.id, dropPkg.id, eventPkg.id, fullPkg.id, donePkg.id]) {
          await prisma.package.delete({ where: { id } }).catch(() => {})
        }
      })

      await loginAsAuditClient(page, prisma, clientId)
      const post = (runId: string, data: unknown) => page.request.post(`/api/my/classes/${runId}/enroll`, { data })

      // The whole course.
      expect((await post(courseRun.id, { type: 'FULL' })).status(), 'joining a free class').toBe(201)
      // The same seat again is not a second seat.
      const twice = await post(courseRun.id, { type: 'FULL' })
      expect(twice.status(), 'booking the same class twice').toBeGreaterThanOrEqual(400)
      expect(await prisma.classEnrollment.count({ where: { classRunId: courseRun.id, clientId } })).toBe(1)

      // Three casual dates in one go — one enrolment each.
      const three = await post(dropRun.id, { type: 'DROP_IN', sessionIds: future.slice(0, 3) })
      expect(three.status(), await three.text()).toBe(201)
      expect(
        await prisma.classEnrollment.count({ where: { classRunId: dropRun.id, clientId } }),
        'three dates booked at once should be three enrolments',
      ).toBe(3)

      // A date that has already been and gone.
      const gone = await post(dropRun.id, { type: 'DROP_IN', sessionIds: [past.id] })
      expect(gone.status(), 'booking a date in the past').toBeGreaterThanOrEqual(400)
      expect(await prisma.classEnrollment.count({ where: { dropInSessionId: past.id } })).toBe(0)

      // A ticketed event must name a ticket type — and the type's own cap holds.
      const noTier = await post(eventRun.id, { type: 'FULL' })
      expect(noTier.status(), 'an event that sells tickets must be told which one').toBe(400)
      expect((await post(eventRun.id, { type: 'FULL', ticketTierId: early.id, quantity: 2 })).status()).toBe(201)
      const overCap = await post(eventRun.id, { type: 'FULL', ticketTierId: early.id, quantity: 2 })
      expect(overCap.status(), 'a ticket type capped at 2 must not sell 4').toBeGreaterThanOrEqual(400)
      // …and a tier from a DIFFERENT event is not a tier of this one.
      const strayTier = await post(courseRun.id, { type: 'FULL', ticketTierId: general.id })
      expect(strayTier.status(), 'a ticket type from another event').toBeGreaterThanOrEqual(400)

      // Full, and finished.
      const full = await post(fullRun.id, { type: 'FULL' })
      expect(full.status(), 'a class with no seats left').toBeGreaterThanOrEqual(400)
      expect(await prisma.classEnrollment.count({ where: { classRunId: fullRun.id } })).toBe(1)
      const finished = await post(doneRun.id, { type: 'FULL' })
      expect(finished.status(), 'a course that has finished').toBe(409)
    } finally {
      for (const fn of bin.reverse()) await fn().catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('buys from the shop — picks a size, is refused an empty shelf, and cannot ask for a size that isn’t there', async ({ page }) => {
    const prisma = await makePrisma()
    const tag = Date.now().toString(36)
    const bin: Array<() => Promise<unknown>> = []
    try {
      const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })

      const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, tag)
      const clientId = client.id
      bin.push(cleanupClient)

      const harness = await prisma.product.create({
        data: { trainerId: trainer.id, name: `Audit harness ${tag}`, priceCents: 4500, active: true, requirePayment: false },
      })
      const small = await prisma.productVariant.create({ data: { productId: harness.id, trainerId: trainer.id, name: 'Small', priceCents: 4000, stockCount: 3, order: 0 } })
      const medium = await prisma.productVariant.create({ data: { productId: harness.id, trainerId: trainer.id, name: 'Medium', stockCount: 0, order: 1 } })
      const empty = await prisma.product.create({
        data: { trainerId: trainer.id, name: `Audit sold out ${tag}`, priceCents: 2500, stockCount: 0, active: true, requirePayment: false },
      })
      bin.push(async () => {
        for (const id of [harness.id, empty.id]) {
          await prisma.invoice.deleteMany({ where: { sourceType: 'PRODUCT', sourceId: id } })
          await prisma.productRequest.deleteMany({ where: { productId: id } })
          await prisma.stockMovement.deleteMany({ where: { productId: id } })
        }
        await prisma.productVariant.deleteMany({ where: { productId: harness.id } })
        await prisma.product.delete({ where: { id: harness.id } }).catch(() => {})
        await prisma.product.delete({ where: { id: empty.id } }).catch(() => {})
      })

      await loginAsAuditClient(page, prisma, clientId)
      const ask = (productId: string, data: unknown) => page.request.post(`/api/my/products/${productId}/request`, { data })

      // A product with sizes can't be asked for in the abstract.
      expect((await ask(harness.id, {})).status(), 'no size picked').toBe(400)
      // A size that isn't one of this product's.
      expect((await ask(harness.id, { variantId: 'not-a-variant' })).status()).toBe(404)
      // The one with stock.
      expect((await ask(harness.id, { variantId: small.id })).status()).toBe(201)
      // The one without.
      expect((await ask(harness.id, { variantId: medium.id })).status(), 'a size with nothing on the shelf').toBe(409)
      // A plain product with an empty shelf.
      expect((await ask(empty.id, {})).status(), 'a product with nothing left').toBe(409)

      // The Small came off the shelf; the Medium never moved.
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: small.id } })).stockCount).toBe(2)
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: medium.id } })).stockCount).toBe(0)
      expect((await prisma.product.findUniqueOrThrow({ where: { id: empty.id } })).stockCount).toBe(0)
      expect(await prisma.productRequest.count({ where: { productId: harness.id } })).toBe(1)
    } finally {
      for (const fn of bin.reverse()) await fn().catch(() => {})
      await prisma.$disconnect()
    }
  })
})

test.describe('client audit — known bugs, part two', () => {
  // ── C-4 ────────────────────────────────────────────────────────────────────
  test('C-4 · a paid digital product’s download URL is not sent to a client who hasn’t bought it', async ({ page }) => {
    // listShopProducts selects downloadUrl for every product and my-shop/page
    // hands it to <ShopGrid>, a 'use client' component — so the URL is
    // serialised into the page for everyone. The button was hidden; the link
    // was not. Fixed 2026-08-04 — the server resolves it per client.
    const prisma = await makePrisma()
    const secret = `https://blob.example.test/audit-${Date.now().toString(36)}-paid-guide.pdf`
    let productId: string | null = null
    let dropClient: (() => Promise<void>) | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
      const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, Date.now().toString(36))
      dropClient = cleanupClient
      const clientId = client.id
      const p = await prisma.product.create({
        data: {
          trainerId: trainer.id, name: `Audit paid download ${Date.now()}`, kind: 'DIGITAL',
          priceCents: 900, downloadUrl: secret, active: true,
        },
      })
      productId = p.id

      await loginAsAuditClient(page, prisma, clientId)
      await page.goto('/my-shop')
      const html = await page.content()
      expect(html, 'the product should be on the shelf').toContain('Audit paid download')
      expect(html, 'its download URL must not be handed out before purchase').not.toContain(secret)

      // The JSON door has to be shut too, not just the page.
      const api = await page.request.get('/api/my/products')
      expect(await api.text(), 'the products API must not hand it out either').not.toContain(secret)

      // C-8 · and it stays shut when the trainer can't take cards. Priced is
      // priced — payments being off decides HOW they pay, not whether they must.
      const list = (await api.json()) as { id: string; downloadUrl: string | null }[]
      expect(list.find(x => x.id === p.id)?.downloadUrl, 'a priced download is not free').toBeNull()

      // Once they've actually got it, the file opens.
      const fulfilled = await prisma.productRequest.create({
        data: { clientId, productId: p.id, status: 'FULFILLED', fulfilledAt: new Date() },
      })
      const after = await page.request.get('/api/my/products')
      const owned = (await after.json()) as { id: string; downloadUrl: string | null }[]
      expect(owned.find(x => x.id === p.id)?.downloadUrl, 'a bought download opens').toBe(secret)
      await prisma.productRequest.delete({ where: { id: fulfilled.id } }).catch(() => {})
    } finally {
      await dropClient?.().catch(() => {})
      if (productId) {
        await prisma.productRequest.deleteMany({ where: { productId } }).catch(() => {})
        await prisma.product.delete({ where: { id: productId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // ── C-5 ────────────────────────────────────────────────────────────────────
  test('C-5 · a sold-out product says so on the shelf, not after you tap it', async ({ page }) => {
    // "Out of stock" only ever appeared INSIDE the product sheet, so a client
    // browsed, picked the thing they wanted, tapped it, and only then found out
    // it was gone. Fixed 2026-08-04.
    const prisma = await makePrisma()
    const tag = Date.now().toString(36)
    let goneId: string | null = null
    let hereId: string | null = null
    let dropClient: (() => Promise<void>) | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
      const { client, cleanupClient } = await makeAuditClient(prisma, trainer.id, tag)
      dropClient = cleanupClient
      const gone = await prisma.product.create({
        data: { trainerId: trainer.id, name: `Audit sold out ${tag}`, priceCents: 1200, stockCount: 0, active: true },
      })
      goneId = gone.id
      const here = await prisma.product.create({
        data: { trainerId: trainer.id, name: `Audit in stock ${tag}`, priceCents: 1200, stockCount: 3, active: true },
      })
      hereId = here.id

      await loginAsAuditClient(page, prisma, client.id)
      await page.goto('/my-shop')

      const soldOutCard = page.locator('button', { hasText: `Audit sold out ${tag}` }).first()
      await expect(soldOutCard).toContainText('Sold out')

      // And the one that IS in stock must not be labelled — a shelf where
      // everything says sold out tells the client nothing.
      const stockedCard = page.locator('button', { hasText: `Audit in stock ${tag}` }).first()
      await expect(stockedCard).not.toContainText('Sold out')
    } finally {
      await dropClient?.().catch(() => {})
      for (const id of [goneId, hereId]) {
        if (id) await prisma.product.delete({ where: { id } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})
