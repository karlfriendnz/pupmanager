/**
 * CLIENT-SIDE AUDIT FIXTURE — local dev DB only.
 *
 * Builds two throwaway trainer businesses with a realistic spread of offerings,
 * products, library items, sessions, notes and invoices, plus an established
 * client who trains with BOTH (so cross-tenant leaks are testable), and a
 * second client on trainer A (so client→client leaks are testable).
 *
 * Never touches the demo login. Run:
 *   npx dotenv -e .env.development.local -o -- npx tsx tests/audit/client-fixture.ts
 * Tear down with:
 *   npx dotenv -e .env.development.local -o -- npx tsx tests/audit/client-fixture.ts --teardown
 */
import { scriptPrisma } from '../../src/lib/prisma-script'
import bcrypt from 'bcryptjs'

const prisma = scriptPrisma()

export const F = {
  trainerA: { email: 'audit.trainer.a@pupaudit.test', password: 'AuditPup2026!', business: 'Audit Paws Academy', slug: 'audit-paws-academy' },
  trainerB: { email: 'audit.trainer.b@pupaudit.test', password: 'AuditPup2026!', business: 'Rival Audit Dogs', slug: 'rival-audit-dogs' },
  // The established dog owner — a client of BOTH businesses.
  owner: { email: 'audit.owner@pupaudit.test', password: 'AuditPup2026!', name: 'Priya Ngātaierua-Fitzwilliam 🐕' },
  // A second client on trainer A — the "someone else's data" target.
  other: { email: 'audit.other@pupaudit.test', password: 'AuditPup2026!', name: 'Other Owner' },
  // A client with NOTHING (empty states).
  empty: { email: 'audit.empty@pupaudit.test', password: 'AuditPup2026!', name: 'Empty Ellie' },
  // Signup journey uses a fresh address each run.
  PRIVATE_ANSWER: 'PRIVATE-RISK-RATING-DO-NOT-LEAK',
  PUBLIC_ANSWER: 'Bella did brilliantly with recall today',
  DRAFT_ANSWER: 'DRAFT-UNSENT-NOTES-DO-NOT-LEAK',
  OTHER_CLIENT_ANSWER: 'OTHER-CLIENT-NOTES-DO-NOT-LEAK',
  TRAINER_B_ANSWER: 'TRAINER-B-NOTES-DO-NOT-LEAK',
  PRIVATE_INTAKE_LABEL: 'Internal risk rating (team only)',
  HIDDEN_PRODUCT: 'Audit Hidden Clicker',
  HIDDEN_OFFERING: 'Audit Term 4 (not yet visible)',
}

const day = 24 * 60 * 60 * 1000
const now = Date.now()
const at = (offsetDays: number, hour = 10) => {
  const d = new Date(now + offsetDays * day)
  d.setHours(hour, 0, 0, 0)
  return d
}

async function makeUser(email: string, name: string, password: string, role: 'TRAINER' | 'CLIENT') {
  const hash = await bcrypt.hash(password, 12)
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) user = await prisma.user.create({ data: { email, name, role, emailVerified: new Date() } })
  else user = await prisma.user.update({ where: { id: user.id }, data: { name, role, emailVerified: new Date() } })
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({ data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash } })
  return user
}

async function teardown() {
  const emails = [F.trainerA.email, F.trainerB.email, F.owner.email, F.other.email, F.empty.email]
  const users = await prisma.user.findMany({ where: { OR: [{ email: { in: emails } }, { email: { endsWith: '@pupauditsignup.test' } }] }, select: { id: true } })
  const ids = users.map(u => u.id)
  const tps = await prisma.trainerProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  for (const tp of tps) {
    await prisma.trainingSession.deleteMany({ where: { trainerId: tp.id } })
    await prisma.classRun.deleteMany({ where: { trainerId: tp.id } })
    await prisma.package.deleteMany({ where: { trainerId: tp.id } })
    await prisma.product.deleteMany({ where: { trainerId: tp.id } })
    await prisma.membership.deleteMany({ where: { trainerId: tp.id } })
    await prisma.libraryType.deleteMany({ where: { trainerId: tp.id } })
    await prisma.form.deleteMany({ where: { trainerId: tp.id } })
    await prisma.sessionForm.deleteMany({ where: { trainerId: tp.id } })
    await prisma.customField.deleteMany({ where: { trainerId: tp.id } })
    await prisma.clientProfile.deleteMany({ where: { trainerId: tp.id } })
  }
  await prisma.clientProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.trainerProfile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  console.log('torn down', ids.length, 'users')
}

async function main() {
  if (process.argv.includes('--teardown')) return teardown()
  await teardown() // idempotent rebuild

  // ── Trainer A ────────────────────────────────────────────────────────────
  const uA = await makeUser(F.trainerA.email, 'Ada Audit', F.trainerA.password, 'TRAINER')
  const A = await prisma.trainerProfile.create({
    data: {
      userId: uA.id, businessName: F.trainerA.business, slug: F.trainerA.slug,
      phone: '+64 21 000 0001', showPhoneToClients: true, publicEmail: 'hello@auditpaws.test',
      website: 'https://auditpaws.test', emailAccentColor: '#0f766e', payoutCurrency: 'nzd',
      trialEndsAt: new Date(now + 90 * day), defaultRequirePayment: false,
    },
  })

  const uB = await makeUser(F.trainerB.email, 'Bianca Rival', F.trainerB.password, 'TRAINER')
  const B = await prisma.trainerProfile.create({
    data: {
      userId: uB.id, businessName: F.trainerB.business, slug: F.trainerB.slug,
      phone: '+64 21 000 0002', payoutCurrency: 'nzd', trialEndsAt: new Date(now + 90 * day),
      defaultRequirePayment: false,
    },
  })

  // ── Custom fields (trainer A) ────────────────────────────────────────────
  const cfVet = await prisma.customField.create({ data: { trainerId: A.id, label: 'Vet clinic', type: 'TEXT', required: true, order: 0, appliesTo: 'OWNER' } })
  const cfHear = await prisma.customField.create({ data: { trainerId: A.id, label: 'How did you hear about us', type: 'DROPDOWN', required: false, options: ['Google', 'Friend', 'Instagram'], order: 1, appliesTo: 'OWNER' } })

  // ── Intake form with required / optional / PRIVATE questions ─────────────
  const intake = await prisma.form.create({
    data: {
      trainerId: A.id, name: 'Audit New Client Intake', usableAsIntake: true, isActive: true,
      description: '<p>Tell us about your dog.</p>',
      questions: [
        { id: 'q_name', type: 'CLIENT_FIELD', fieldKey: 'name', required: true },
        { id: 'q_phone', type: 'CLIENT_FIELD', fieldKey: 'phone', required: true },
        { id: 'q_dogname', type: 'CLIENT_FIELD', fieldKey: 'dogName', required: true },
        { id: 'q_challenge', type: 'SHORT_TEXT', label: "Your dog's biggest challenge", required: true },
        { id: 'q_notes', type: 'LONG_TEXT', label: 'Anything else we should know?', required: false },
        { id: 'q_vet', type: 'CUSTOM_FIELD', customFieldId: cfVet.id, required: true },
        { id: 'q_hear', type: 'CUSTOM_FIELD', customFieldId: cfHear.id, required: false },
        { id: 'q_private', type: 'SHORT_TEXT', label: F.PRIVATE_INTAKE_LABEL, required: false, isPrivate: true },
      ],
      steps: [],
    },
  })

  // Public enquiry form that runs straight through to an account + the intake.
  const enquiryForm = await prisma.form.create({
    data: {
      trainerId: A.id, name: 'Audit Enquiry', usableAsEnquiry: true, isActive: true, slug: 'audit-enquiry',
      questions: [
        { id: 'e_name', type: 'CLIENT_FIELD', fieldKey: 'name', required: true },
        { id: 'e_email', type: 'CLIENT_FIELD', fieldKey: 'email', required: true },
        { id: 'e_msg', type: 'LONG_TEXT', label: 'How can we help?', required: false },
      ],
      steps: [], continueToAccount: true, continueIntakeFormId: intake.id,
    },
  })

  // ── Session form with a PRIVATE question ────────────────────────────────
  const sessForm = await prisma.sessionForm.create({
    data: {
      trainerId: A.id, name: 'Audit Session Write-up', isActive: true,
      introText: 'Here is how today went.',
      questions: [
        { id: 's_public', type: 'LONG_TEXT', label: 'What we worked on', required: true },
        { id: 's_private', type: 'LONG_TEXT', label: 'Trainer-only risk note', required: false, isPrivate: true },
      ],
    },
  })

  // ── Library ─────────────────────────────────────────────────────────────
  const libType = await prisma.libraryType.create({ data: { trainerId: A.id, name: 'Homework' } })
  const theme = await prisma.libraryTheme.create({ data: { typeId: libType.id, name: 'Basics' } })
  const media = [
    { kind: 'image', url: 'https://placehold.co/600x400/png', title: 'Hand position' },
    { kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Demo clip' },
    { kind: 'document', url: 'https://example.test/handout.pdf', title: 'Handout', fileName: 'handout.pdf' },
  ]
  const lib1 = await prisma.libraryTask.create({
    data: {
      typeId: libType.id, themeId: theme.id, title: 'Loose lead walking', description: '<p>Five minutes a day.</p>', repetitions: 5,
      media, videos: [{ url: media[1].url, title: 'Demo clip' }], videoUrl: media[1].url,
      imageUrl: media[0].url, fileUrl: media[2].url, fileName: 'handout.pdf', wantsLog: true,
    },
  })
  await prisma.libraryTask.create({
    data: { typeId: libType.id, themeId: theme.id, title: 'Crate settle', description: '<p>Reading material only.</p>', wantsLog: false, order: 1 },
  })

  // ── Offerings ───────────────────────────────────────────────────────────
  const p1to1 = await prisma.package.create({
    data: {
      trainerId: A.id, name: 'One-to-one Foundations', description: '<p>Four private consults.</p>',
      sessionCount: 4, weeksBetween: 1, durationMins: 60, priceCents: 12000,
      clientSelfBook: true, selfBookRequiresApproval: false, order: 0,
      defaultSessionFormId: sessForm.id,
    },
  })
  await prisma.availabilitySlot.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map(d => ({ trainerId: A.id, dayOfWeek: d, startTime: '09:00', endTime: '17:00' })),
  }).catch(() => {})

  const pClass = await prisma.package.create({
    data: {
      trainerId: A.id, name: 'Puppy Group Class', description: '<p>Six weeks of puppy basics.</p>',
      isGroup: true, capacity: 6, sessionCount: 4, weeksBetween: 1, priceCents: 20000,
      publicEnrollment: true, allowWaitlist: true, order: 1,
    },
  })
  const runClass = await prisma.classRun.create({
    data: { trainerId: A.id, packageId: pClass.id, name: 'Puppy Class — Audit Term', startDate: at(7), capacity: 6, location: 'The Hall' },
  })
  for (let i = 0; i < 4; i++) {
    await prisma.trainingSession.create({
      data: { trainerId: A.id, classRunId: runClass.id, sessionIndex: i + 1, title: `Puppy Class session ${i + 1}`, scheduledAt: at(7 + i * 7, 18), durationMins: 60, location: 'The Hall' },
    })
  }

  // Casual / drop-in class with several dated slots
  const pDropIn = await prisma.package.create({
    data: {
      trainerId: A.id, name: 'Casual Drop-in Class', description: '<p>Come when you can.</p>',
      isGroup: true, allowDropIn: true, dropInPriceCents: 2500, capacity: 8, sessionCount: 0, order: 2,
      publicEnrollment: true,
    },
  })
  const slot = await prisma.packageSessionSlot.create({
    data: { packageId: pDropIn.id, day: 2, startTime: '15:00', endTime: '16:00', capacity: 8, priceCents: 2500, recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=6' },
  })
  const runDropIn = await prisma.classRun.create({
    data: { trainerId: A.id, packageId: pDropIn.id, name: 'Casual Drop-ins', startDate: at(2), capacity: 8, location: 'The Park' },
  })
  const dropInSessions = []
  for (let i = 0; i < 6; i++) {
    dropInSessions.push(await prisma.trainingSession.create({
      data: { trainerId: A.id, classRunId: runDropIn.id, packageSessionSlotId: slot.id, sessionIndex: i + 1, title: 'Casual Drop-in', scheduledAt: at(2 + i * 7, 15), durationMins: 60, location: 'The Park' },
    }))
  }
  // One PAST drop-in date — must not be bookable.
  const pastDropIn = await prisma.trainingSession.create({
    data: { trainerId: A.id, classRunId: runDropIn.id, packageSessionSlotId: slot.id, sessionIndex: 0, title: 'Casual Drop-in (past)', scheduledAt: at(-5, 15), durationMins: 60, location: 'The Park' },
  })

  // Event with ticket tiers
  const pEvent = await prisma.package.create({
    data: {
      trainerId: A.id, name: 'Scentwork Workshop', description: '<p>A one-day workshop.</p>',
      isGroup: true, isEvent: true, sessionCount: 1, capacity: 10, priceCents: 6000, publicEnrollment: true, order: 3,
    },
  })
  const tierEarly = await prisma.packageTicketTier.create({ data: { packageId: pEvent.id, name: 'Early bird', priceCents: 4000, capacity: 2, order: 0 } })
  const tierGeneral = await prisma.packageTicketTier.create({ data: { packageId: pEvent.id, name: 'General', priceCents: 6000, capacity: 8, order: 1 } })
  const runEvent = await prisma.classRun.create({ data: { trainerId: A.id, packageId: pEvent.id, name: 'Scentwork Workshop — Audit', startDate: at(14), capacity: 10, location: 'The Barn' } })
  await prisma.trainingSession.create({ data: { trainerId: A.id, classRunId: runEvent.id, sessionIndex: 1, title: 'Scentwork Workshop', scheduledAt: at(14, 9), durationMins: 240, location: 'The Barn' } })

  // NOT-YET-VISIBLE offering (visibleFrom in the future) — direct URL probe
  const pHidden = await prisma.package.create({
    data: {
      trainerId: A.id, name: F.HIDDEN_OFFERING, isGroup: true, sessionCount: 2, capacity: 5, priceCents: 15000,
      publicEnrollment: true, visibleFrom: new Date(now + 60 * day), order: 4,
    },
  })
  const runHidden = await prisma.classRun.create({ data: { trainerId: A.id, packageId: pHidden.id, name: 'Term 4 Advanced — Audit', startDate: at(70), capacity: 5 } })
  await prisma.trainingSession.create({ data: { trainerId: A.id, classRunId: runHidden.id, sessionIndex: 1, title: 'Term 4 s1', scheduledAt: at(70, 18) } })

  // FULL class (capacity 1, already taken)
  const pFull = await prisma.package.create({
    data: { trainerId: A.id, name: 'Audit Full Class', isGroup: true, sessionCount: 1, capacity: 1, priceCents: 5000, publicEnrollment: true, order: 5 },
  })
  const runFull = await prisma.classRun.create({ data: { trainerId: A.id, packageId: pFull.id, name: 'Audit Full Class run', startDate: at(10), capacity: 1 } })
  await prisma.trainingSession.create({ data: { trainerId: A.id, classRunId: runFull.id, sessionIndex: 1, title: 'Full class s1', scheduledAt: at(10, 18) } })

  // PAST class run — nothing left to book
  const pPast = await prisma.package.create({
    data: { trainerId: A.id, name: 'Audit Finished Class', isGroup: true, sessionCount: 1, capacity: 5, priceCents: 5000, publicEnrollment: true, order: 6 },
  })
  const runPast = await prisma.classRun.create({ data: { trainerId: A.id, packageId: pPast.id, name: 'Audit Finished Class run', startDate: at(-30), capacity: 5, status: 'COMPLETED' } })
  await prisma.trainingSession.create({ data: { trainerId: A.id, classRunId: runPast.id, sessionIndex: 1, title: 'Finished class s1', scheduledAt: at(-30, 18), status: 'COMPLETED' } })

  // ── Products ────────────────────────────────────────────────────────────
  const prodPlain = await prisma.product.create({ data: { trainerId: A.id, name: 'Audit Training Treats', description: '<p>Liver, mostly.</p>', priceCents: 1500, stockCount: 20, active: true, featured: true, order: 0 } })
  const prodVariant = await prisma.product.create({ data: { trainerId: A.id, name: 'Audit Harness', description: '<p>Y-front harness.</p>', priceCents: 4500, stockCount: null, active: true, order: 1 } })
  const vS = await prisma.productVariant.create({ data: { productId: prodVariant.id, trainerId: A.id, name: 'Small', priceCents: 4000, stockCount: 5, order: 0 } })
  const vM = await prisma.productVariant.create({ data: { productId: prodVariant.id, trainerId: A.id, name: 'Medium', priceCents: 4500, stockCount: 0, order: 1 } })
  const vL = await prisma.productVariant.create({ data: { productId: prodVariant.id, trainerId: A.id, name: 'Large', priceCents: null, stockCount: 3, order: 2 } })
  const prodDigital = await prisma.product.create({ data: { trainerId: A.id, name: 'Audit Puppy Guide PDF', kind: 'DIGITAL', priceCents: 900, downloadUrl: 'https://example.test/puppy-guide.pdf', active: true, order: 2 } })
  const prodOOS = await prisma.product.create({ data: { trainerId: A.id, name: 'Audit Long Line', priceCents: 2500, stockCount: 0, active: true, order: 3 } })
  const prodHidden = await prisma.product.create({ data: { trainerId: A.id, name: F.HIDDEN_PRODUCT, priceCents: 999, stockCount: 5, active: false, order: 4 } })

  // ── Membership ──────────────────────────────────────────────────────────
  const memb = await prisma.membership.create({
    data: { trainerId: A.id, name: 'Audit Starter Bundle', description: '<p>Consults + treats.</p>', priceCents: 30000, cadence: 'ONE_OFF', published: true, slug: 'audit-starter-bundle' },
  })
  await prisma.membershipItem.create({ data: { membershipId: memb.id, kind: 'PACKAGE', packageId: p1to1.id, quantity: 1, order: 0 } })
  await prisma.membershipItem.create({ data: { membershipId: memb.id, kind: 'PRODUCT', productId: prodPlain.id, quantity: 2, order: 1 } })

  // ── Trainer B offerings (cross-tenant probes) ───────────────────────────
  const bProduct = await prisma.product.create({ data: { trainerId: B.id, name: 'Rival Secret Treats', priceCents: 1200, stockCount: 9, active: true } })
  const bPackage = await prisma.package.create({ data: { trainerId: B.id, name: 'Rival Consult', priceCents: 9000, clientSelfBook: true, selfBookRequiresApproval: false } })
  const bSessForm = await prisma.sessionForm.create({
    data: { trainerId: B.id, name: 'Rival write-up', questions: [{ id: 'b_public', type: 'LONG_TEXT', label: 'Notes', required: false }] },
  })

  // ── Clients ─────────────────────────────────────────────────────────────
  const uOwner = await makeUser(F.owner.email, F.owner.name, F.owner.password, 'CLIENT')
  const uOther = await makeUser(F.other.email, F.other.name, F.other.password, 'CLIENT')
  const uEmpty = await makeUser(F.empty.email, F.empty.name, F.empty.password, 'CLIENT')

  const cpOwnerA = await prisma.clientProfile.create({
    data: { userId: uOwner.id, trainerId: A.id, phone: '+64 21 111 1111', intakeCompletedAt: new Date() },
  })
  const dog1 = await prisma.dog.create({ data: { name: 'Bella', breed: 'Border Collie', clientProfileId: cpOwnerA.id } })
  const dog2 = await prisma.dog.create({ data: { name: 'Mr. Wigglebottom the Third 🦴', breed: 'Dachshund', clientProfileId: cpOwnerA.id } })
  await prisma.clientProfile.update({ where: { id: cpOwnerA.id }, data: { dogId: dog1.id } })
  await prisma.customFieldValue.create({ data: { fieldId: cfVet.id, clientId: cpOwnerA.id, value: 'Vet on Main St' } })

  // Same person, trainer B
  const cpOwnerB = await prisma.clientProfile.create({ data: { userId: uOwner.id, trainerId: B.id, phone: '+64 21 111 1111', intakeCompletedAt: new Date() } })

  // Second client on trainer A
  const cpOther = await prisma.clientProfile.create({ data: { userId: uOther.id, trainerId: A.id, phone: '+64 21 222 2222', intakeCompletedAt: new Date() } })
  const dogOther = await prisma.dog.create({ data: { name: 'Rex', clientProfileId: cpOther.id } })
  await prisma.clientProfile.update({ where: { id: cpOther.id }, data: { dogId: dogOther.id } })

  // Empty client — gated on the intake form, nothing else.
  const cpEmpty = await prisma.clientProfile.create({ data: { userId: uEmpty.id, trainerId: A.id, phone: '+64 21 333 3333', intakeFormId: intake.id } })

  // Fill the full class with the OTHER client so it is genuinely full.
  await prisma.classEnrollment.create({ data: { classRunId: runFull.id, clientId: cpOther.id, type: 'FULL', status: 'ENROLLED' } })

  // ── Sessions for the established client (trainer A) ─────────────────────
  const cpkg = await prisma.clientPackage.create({ data: { packageId: p1to1.id, clientId: cpOwnerA.id, startDate: at(-14) } })

  const sUpcoming = await prisma.trainingSession.create({
    data: { trainerId: A.id, clientId: cpOwnerA.id, dogId: dog1.id, clientPackageId: cpkg.id, title: 'Foundations session 3', scheduledAt: at(3, 11), durationMins: 60, status: 'UPCOMING', location: 'Your place' },
  })
  // Past but NOT marked complete — its write-up is a draft the client must not see.
  const sPastDraft = await prisma.trainingSession.create({
    data: { trainerId: A.id, clientId: cpOwnerA.id, dogId: dog1.id, clientPackageId: cpkg.id, title: 'Foundations session 2', scheduledAt: at(-2, 11), durationMins: 60, status: 'UPCOMING' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: sPastDraft.id, formId: sessForm.id, answers: { s_public: F.DRAFT_ANSWER, s_private: F.PRIVATE_ANSWER }, sentAt: null },
  })
  // Completed, with a public answer AND a private answer.
  const sDone = await prisma.trainingSession.create({
    data: { trainerId: A.id, clientId: cpOwnerA.id, dogId: dog1.id, clientPackageId: cpkg.id, title: 'Foundations session 1', scheduledAt: at(-9, 11), durationMins: 60, status: 'COMPLETED' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: sDone.id, formId: sessForm.id, answers: { s_public: F.PUBLIC_ANSWER, s_private: F.PRIVATE_ANSWER }, introMessage: 'Great first session.', sentAt: null },
  })

  // ── Homework ────────────────────────────────────────────────────────────
  // BEFORE the upcoming session — visible now.
  await prisma.trainingTask.create({
    data: {
      clientId: cpOwnerA.id, dogId: dog1.id, sessionId: sUpcoming.id, date: at(3), timing: 'BEFORE_SESSION',
      title: 'AUDIT-BEFORE bring a hungry dog', description: '<p>Skip breakfast.</p>', libraryTaskId: lib1.id,
      media, videos: [{ url: media[1].url }], videoUrl: media[1].url, imageUrls: [media[0].url], wantsLog: true,
    },
  })
  // AFTER the upcoming session — must be HIDDEN until it runs.
  await prisma.trainingTask.create({
    data: {
      clientId: cpOwnerA.id, dogId: dog1.id, sessionId: sUpcoming.id, date: at(3), timing: 'AFTER_SESSION',
      title: 'AUDIT-AFTER-HIDDEN practise the recall', description: '<p>Not yet.</p>', wantsLog: true,
    },
  })
  // AFTER a session that HAS run — visible.
  await prisma.trainingTask.create({
    data: {
      clientId: cpOwnerA.id, dogId: dog1.id, sessionId: sDone.id, date: at(-9), timing: 'AFTER_SESSION',
      title: 'AUDIT-AFTER-VISIBLE loose lead walking', description: '<p>Five minutes a day.</p>', libraryTaskId: lib1.id,
      media, videos: [{ url: media[1].url }], videoUrl: media[1].url, imageUrls: [media[0].url], wantsLog: true, repetitions: 5,
    },
  })

  // ── The OTHER client's private data on trainer A ────────────────────────
  const sOther = await prisma.trainingSession.create({
    data: { trainerId: A.id, clientId: cpOther.id, dogId: dogOther.id, title: 'Other owner session', scheduledAt: at(-4, 11), status: 'COMPLETED' },
  })
  await prisma.sessionFormResponse.create({
    data: { sessionId: sOther.id, formId: sessForm.id, answers: { s_public: F.OTHER_CLIENT_ANSWER }, sentAt: new Date() },
  })
  await prisma.trainingTask.create({
    data: { clientId: cpOther.id, sessionId: sOther.id, date: at(-4), timing: 'AFTER_SESSION', title: 'OTHER-CLIENT-HOMEWORK-DO-NOT-LEAK' },
  })

  // ── The same person's data at trainer B ─────────────────────────────────
  const sB = await prisma.trainingSession.create({
    data: { trainerId: B.id, clientId: cpOwnerB.id, title: 'Rival session', scheduledAt: at(-3, 11), status: 'COMPLETED' },
  })
  await prisma.sessionFormResponse.create({ data: { sessionId: sB.id, formId: bSessForm.id, answers: { b_public: F.TRAINER_B_ANSWER }, sentAt: new Date() } })
  await prisma.trainingTask.create({ data: { clientId: cpOwnerB.id, sessionId: sB.id, date: at(-3), timing: 'AFTER_SESSION', title: 'TRAINER-B-HOMEWORK-DO-NOT-LEAK' } })

  // ── Invoices ────────────────────────────────────────────────────────────
  const invUnpaid = await prisma.invoice.create({
    data: { trainerId: A.id, clientId: cpOwnerA.id, amountCents: 12000, currency: 'nzd', status: 'UNPAID', description: 'One-to-one Foundations', sentAt: new Date(), sourceType: 'PACKAGE', sourceId: cpkg.id },
  })
  await prisma.invoiceLineItem.create({ data: { invoiceId: invUnpaid.id, description: 'Foundations x4', quantity: 1, unitAmountCents: 12000, amountCents: 12000 } })
  const invPaid = await prisma.invoice.create({
    data: { trainerId: A.id, clientId: cpOwnerA.id, amountCents: 1500, amountPaidCents: 1500, currency: 'nzd', status: 'PAID', description: 'Treats', paidAt: new Date(), sentAt: new Date() },
  })
  await prisma.invoiceLineItem.create({ data: { invoiceId: invPaid.id, description: 'Audit Training Treats', quantity: 1, unitAmountCents: 1500, amountCents: 1500 } })
  // The OTHER client's invoice — direct-URL / pay-token probe target.
  const invOther = await prisma.invoice.create({
    data: { trainerId: A.id, clientId: cpOther.id, amountCents: 9999, currency: 'nzd', status: 'UNPAID', description: 'OTHER-CLIENT-INVOICE-DO-NOT-LEAK', sentAt: new Date() },
  })

  const out = {
    trainerA: A.id, trainerB: B.id,
    clientOwnerA: cpOwnerA.id, clientOwnerB: cpOwnerB.id, clientOther: cpOther.id, clientEmpty: cpEmpty.id,
    intakeFormId: intake.id, enquiryFormId: enquiryForm.id, sessionFormId: sessForm.id,
    packages: { p1to1: p1to1.id, pClass: pClass.id, pDropIn: pDropIn.id, pEvent: pEvent.id, pHidden: pHidden.id, pFull: pFull.id, pPast: pPast.id },
    runs: { runClass: runClass.id, runDropIn: runDropIn.id, runEvent: runEvent.id, runHidden: runHidden.id, runFull: runFull.id, runPast: runPast.id },
    tiers: { early: tierEarly.id, general: tierGeneral.id },
    products: { plain: prodPlain.id, variant: prodVariant.id, digital: prodDigital.id, oos: prodOOS.id, hidden: prodHidden.id, rivalB: bProduct.id },
    variants: { s: vS.id, m: vM.id, l: vL.id },
    membershipId: memb.id, bPackageId: bPackage.id,
    sessions: { upcoming: sUpcoming.id, pastDraft: sPastDraft.id, done: sDone.id, other: sOther.id, trainerB: sB.id, pastDropIn: pastDropIn.id, dropIn: dropInSessions.map(s => s.id) },
    invoices: { unpaid: invUnpaid.id, paid: invPaid.id, other: invOther.id, otherToken: invOther.payToken },
    dogs: { bella: dog1.id, wiggle: dog2.id },
  }
  console.log(JSON.stringify(out, null, 1))
  const fs = await import('node:fs')
  fs.writeFileSync('tests/audit/.client-fixture.json', JSON.stringify(out, null, 1))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
