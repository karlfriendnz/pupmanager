import { test, expect, type Page, type APIResponse } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { SEED, TEST_DATABASE_URL } from './test-db'

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY AUDIT — the exhaustive cross-tenant table.
//
// pentest.spec.ts goes DEEP on a handful of routes; pentest-surface.spec.ts goes
// WIDE on auth/role. This one goes wide on TENANCY: for every API route that
// takes an :id, it signs in as Business A's owner and points that route at a
// row owned by a DIFFERENT business. Every one must refuse, and nothing may be
// written.
//
// Written to ENUMERATE rather than hardcode where it can: the victim business is
// built here from one factory, so adding a row kind to `victimFixtures` extends
// the matrix for free. When you add a new /api/**/[id] route, add a line to
// CROSS_TENANT and it is covered forever.
//
// The victim business is created in beforeAll with the `secaudit` prefix and
// removed in afterAll, so no other spec's counts move.
// ─────────────────────────────────────────────────────────────────────────────

const MARK = 'secaudit'
const PW = 'AuditPass!2026x'

function makePrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** Anything outside 2xx means the door held. */
const refused = (r: APIResponse) => r.status() < 200 || r.status() >= 300

interface Victim {
  trainerId: string
  userId: string
  clientId: string
  clientUserId: string
  dogId: string
  packageId: string
  productId: string
  productCategoryId: string
  sessionId: string
  invoiceId: string
  tagId: string
  formId: string
  libTypeId: string
  themeId: string
  libTaskId: string
  classRunId: string
  membershipId: string
  locationId: string
  customFieldId: string
  achievementId: string
  emailTemplateId: string
  sessionFormId: string
  embedFormId: string
  enquiryId: string
  waitlistId: string
  discountId: string
  bookingPageId: string
  availabilityId: string
  blackoutId: string
  commsTemplateId: string
  trainingTemplateId: string
  timeRateId: string
  homeworkId: string
  todoId: string
}

/**
 * Build a whole second business with one of everything. Everything is prefixed
 * so the teardown can find it, and nothing touches Business A.
 */
async function victimFixtures(prisma: PrismaClient): Promise<Victim> {
  const hash = await bcrypt.hash(PW, 10)
  const user = await prisma.user.create({
    data: {
      email: `${MARK}-victim-owner@e2e.test`, name: 'Vic Victim', role: 'TRAINER', emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const profile = await prisma.trainerProfile.create({
    data: { userId: user.id, businessName: 'Audit Victim Dogs', slug: `${MARK}-victim`, phone: '+6421000009', subscriptionStatus: 'ACTIVE' },
  })
  await prisma.trainerMembership.create({
    data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
  })

  const clientUser = await prisma.user.create({
    data: {
      email: `${MARK}-victim-client@e2e.test`, name: 'Vera Victim', role: 'CLIENT', emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
    },
  })
  const dog = await prisma.dog.create({ data: { name: `${MARK}-VictimDog`, breed: 'Collie' } })
  const client = await prisma.clientProfile.create({
    data: { userId: clientUser.id, trainerId: profile.id, dogId: dog.id, phone: '+6421000008' },
  })
  await prisma.dog.update({ where: { id: dog.id }, data: { clientProfileId: client.id } })

  const t = profile.id
  const pkg = await prisma.package.create({ data: { trainerId: t, name: `${MARK} victim pkg`, priceCents: 10_000, sessionCount: 3 } })
  const product = await prisma.product.create({ data: { trainerId: t, name: `${MARK} victim product`, priceCents: 5_000, active: true } })
  const productCategory = await prisma.productCategory.create({ data: { trainerId: t, name: `${MARK} victim cat` } })
  const session = await prisma.trainingSession.create({
    data: { trainerId: t, clientId: client.id, dogId: dog.id, title: `${MARK} victim session`, scheduledAt: new Date(Date.now() + 86_400_000), durationMins: 60, description: 'PRIVATE VICTIM NOTE' },
  })
  const invoice = await prisma.invoice.create({ data: { trainerId: t, clientId: client.id, amountCents: 12_345, currency: 'NZD', description: `${MARK} victim invoice`, status: 'UNPAID' } })
  const tag = await prisma.tag.create({ data: { trainerId: t, name: `${MARK}-victim-tag`, nameKey: `${MARK}-victim-tag` } })
  const form = await prisma.form.create({ data: { trainerId: t, name: `${MARK} victim form`, usableAsEnquiry: true, slug: `${MARK}-victim-form`, questions: [] } })
  const libType = await prisma.libraryType.create({ data: { trainerId: t, name: `${MARK} victim type` } })
  const theme = await prisma.libraryTheme.create({ data: { typeId: libType.id, name: `${MARK} victim theme` } })
  const libTask = await prisma.libraryTask.create({ data: { themeId: theme.id, title: `${MARK} victim libtask` } })
  const classRun = await prisma.classRun.create({ data: { trainerId: t, packageId: pkg.id, name: `${MARK} victim run`, startDate: new Date(Date.now() + 7 * 86_400_000), capacity: 6 } })
  const membership = await prisma.membership.create({ data: { trainerId: t, name: `${MARK} victim membership`, priceCents: 9_900, published: true, slug: `${MARK}-victim-mem` } })
  const location = await prisma.location.create({ data: { trainerId: t, name: `${MARK} victim location` } })
  const customField = await prisma.customField.create({ data: { trainerId: t, label: `${MARK} victim field`, type: 'TEXT' } })
  const achievement = await prisma.achievement.create({ data: { trainerId: t, name: `${MARK} victim award` } })
  const emailTemplate = await prisma.emailTemplate.create({ data: { trainerId: t, name: `${MARK} victim tmpl`, subject: 'S', body: 'B' } })
  const sessionForm = await prisma.sessionForm.create({ data: { trainerId: t, name: `${MARK} victim sform` } })
  const embedForm = await prisma.embedForm.create({ data: { trainerId: t, title: `${MARK} victim embed` } })
  const enquiry = await prisma.enquiry.create({ data: { trainerId: t, name: `${MARK} victim enquiry`, email: 'venq@e2e.test', message: 'SECRET VICTIM ENQUIRY' } })
  const waitlist = await prisma.waitlistEntry.create({ data: { trainerId: t, name: `${MARK} victim wait`, email: 'vwait@e2e.test' } })
  const discount = await prisma.discount.create({ data: { trainerId: t, name: `${MARK} victim disc`, modifierType: 'PERCENT', modifierValue: 10 } })
  const bookingPage = await prisma.bookingPage.create({ data: { trainerId: t, slug: `${MARK}-victim-bp`, name: `${MARK} victim bp`, enabled: true } })
  const availability = await prisma.availabilitySlot.create({ data: { trainerId: t, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' } })
  const blackout = await prisma.blackoutPeriod.create({ data: { trainerId: t, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), reason: `${MARK} victim bo` } })
  const commsTemplate = await prisma.commsFlowTemplate.create({ data: { trainerId: t, name: `${MARK} victim cft` } })
  const trainingTemplate = await prisma.trainingTemplate.create({ data: { trainerId: t, name: `${MARK} victim ttmpl` } })
  const timeRate = await prisma.timeRate.create({ data: { companyId: t, name: `${MARK} victim rate`, rateCents: 5_000 } })
  const homework = await prisma.trainingTask.create({ data: { clientId: client.id, dogId: dog.id, sessionId: session.id, date: new Date(), title: `${MARK} victim homework` } })
  const todo = await prisma.trainerTodo.create({ data: { companyId: t, title: `${MARK} victim todo`, createdById: user.id } })

  return {
    trainerId: t, userId: user.id, clientId: client.id, clientUserId: clientUser.id, dogId: dog.id,
    packageId: pkg.id, productId: product.id, productCategoryId: productCategory.id, sessionId: session.id,
    invoiceId: invoice.id, tagId: tag.id, formId: form.id, libTypeId: libType.id, themeId: theme.id,
    libTaskId: libTask.id, classRunId: classRun.id, membershipId: membership.id, locationId: location.id,
    customFieldId: customField.id, achievementId: achievement.id, emailTemplateId: emailTemplate.id,
    sessionFormId: sessionForm.id, embedFormId: embedForm.id, enquiryId: enquiry.id, waitlistId: waitlist.id,
    discountId: discount.id, bookingPageId: bookingPage.id, availabilityId: availability.id,
    blackoutId: blackout.id, commsTemplateId: commsTemplate.id, trainingTemplateId: trainingTemplate.id,
    timeRateId: timeRate.id, homeworkId: homework.id, todoId: todo.id,
  }
}

async function removeVictim(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: MARK } },
    select: { id: true, trainerProfile: { select: { id: true } }, clientProfiles: { select: { id: true } } },
  })
  const companyIds = users.map(u => u.trainerProfile?.id).filter(Boolean) as string[]
  const clientIds = users.flatMap(u => u.clientProfiles.map(c => c.id))
  const userIds = users.map(u => u.id)
  // Shares point at Business A's clients too, and there is no revoke route
  // (see the sharing finding) — so clear them here or they outlive the spec.
  await prisma.clientShare.deleteMany({ where: { OR: [{ sharedWithId: { in: companyIds } }, { sharedById: { in: companyIds } }, { clientId: { in: clientIds } }] } })
  await prisma.trainingTask.deleteMany({ where: { clientId: { in: clientIds } } })
  await prisma.invoice.deleteMany({ where: { trainerId: { in: companyIds } } })
  await prisma.trainingSession.deleteMany({ where: { trainerId: { in: companyIds } } })
  await prisma.dog.deleteMany({ where: { clientProfileId: { in: clientIds } } })
  await prisma.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await prisma.trainerMembership.deleteMany({ where: { companyId: { in: companyIds } } })
  await prisma.trainerProfile.deleteMany({ where: { id: { in: companyIds } } })
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

type Probe = { name: string; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; data?: unknown }

/**
 * Every /api/**\/[id] route reachable by a trainer, pointed at the victim's row.
 * Grouped in source order so a new route is easy to slot in.
 */
function crossTenantProbes(v: Victim): Probe[] {
  const iso = new Date().toISOString()
  return [
    // clients
    { name: 'client PATCH', method: 'PATCH', path: `/api/clients/${v.clientId}`, data: { name: 'PWNED' } },
    { name: 'client DELETE', method: 'DELETE', path: `/api/clients/${v.clientId}` },
    { name: 'client dogs GET', method: 'GET', path: `/api/clients/${v.clientId}/dogs` },
    { name: 'client dogs POST', method: 'POST', path: `/api/clients/${v.clientId}/dogs`, data: { name: 'PWNED dog' } },
    { name: 'client dog PATCH', method: 'PATCH', path: `/api/clients/${v.clientId}/dogs/${v.dogId}`, data: { name: 'PWNED' } },
    { name: 'client dog DELETE', method: 'DELETE', path: `/api/clients/${v.clientId}/dogs/${v.dogId}` },
    { name: 'client field-values GET', method: 'GET', path: `/api/clients/${v.clientId}/field-values` },
    { name: 'client field-values POST', method: 'POST', path: `/api/clients/${v.clientId}/field-values`, data: { values: {} } },
    { name: 'client location PATCH', method: 'PATCH', path: `/api/clients/${v.clientId}/location`, data: { addressLine: 'PWNED', addressLat: 1, addressLng: 1, addressPlaceId: 'x' } },
    { name: 'client notify GET', method: 'GET', path: `/api/clients/${v.clientId}/notify` },
    { name: 'client notify POST', method: 'POST', path: `/api/clients/${v.clientId}/notify`, data: { title: 'PWNED', body: 'x' } },
    { name: 'client packages GET', method: 'GET', path: `/api/clients/${v.clientId}/packages` },
    { name: 'client packages POST', method: 'POST', path: `/api/clients/${v.clientId}/packages`, data: { packageId: v.packageId, startDate: iso } },
    { name: 'client achievements GET', method: 'GET', path: `/api/clients/${v.clientId}/achievements` },
    { name: 'client achievements POST', method: 'POST', path: `/api/clients/${v.clientId}/achievements`, data: { achievementId: v.achievementId } },
    { name: 'client achievement DELETE', method: 'DELETE', path: `/api/clients/${v.clientId}/achievements/${v.achievementId}` },
    { name: 'client reinvite POST', method: 'POST', path: `/api/clients/${v.clientId}/reinvite`, data: {} },
    { name: 'client share POST', method: 'POST', path: `/api/clients/${v.clientId}/share`, data: { email: 'x@e2e.test', shareType: 'CO_MANAGE' } },
    { name: 'client product-requests POST', method: 'POST', path: `/api/clients/${v.clientId}/product-requests`, data: { productId: v.productId, quantity: 1 } },
    // dogs
    { name: 'dog PATCH', method: 'PATCH', path: `/api/dogs/${v.dogId}`, data: { name: 'PWNED' } },
    { name: 'dog DELETE', method: 'DELETE', path: `/api/dogs/${v.dogId}` },
    { name: 'dog media GET', method: 'GET', path: `/api/dogs/${v.dogId}/media` },
    { name: 'dog media POST', method: 'POST', path: `/api/dogs/${v.dogId}/media`, data: { url: 'https://x.test/y.jpg', kind: 'PHOTO' } },
    { name: 'dog photo DELETE', method: 'DELETE', path: `/api/dogs/${v.dogId}/photo` },
    // sessions
    { name: 'schedule session GET', method: 'GET', path: `/api/schedule/${v.sessionId}` },
    { name: 'schedule session PATCH', method: 'PATCH', path: `/api/schedule/${v.sessionId}`, data: { title: 'PWNED' } },
    { name: 'schedule session DELETE', method: 'DELETE', path: `/api/schedule/${v.sessionId}` },
    { name: 'session buddies POST', method: 'POST', path: `/api/schedule/${v.sessionId}/buddies`, data: { clientId: v.clientId, dogId: v.dogId } },
    { name: 'session attachments GET', method: 'GET', path: `/api/sessions/${v.sessionId}/attachments` },
    { name: 'session attachments POST', method: 'POST', path: `/api/sessions/${v.sessionId}/attachments`, data: { kind: 'IMAGE', url: 'https://x.test/y.jpg', sizeBytes: 10 } },
    { name: 'session form-responses GET', method: 'GET', path: `/api/sessions/${v.sessionId}/form-responses` },
    { name: 'session form-response PUT', method: 'PUT', path: `/api/sessions/${v.sessionId}/form-responses/${v.sessionFormId}`, data: { answers: {} } },
    { name: 'session linked-fields GET', method: 'GET', path: `/api/sessions/${v.sessionId}/linked-fields` },
    { name: 'session series-step PATCH', method: 'PATCH', path: `/api/sessions/${v.sessionId}/series-step`, data: { stepId: null } },
    { name: 'session default-homework POST', method: 'POST', path: `/api/sessions/${v.sessionId}/default-homework`, data: {} },
    { name: 'session time-entries GET', method: 'GET', path: `/api/sessions/${v.sessionId}/time-entries` },
    { name: 'session polish POST', method: 'POST', path: `/api/sessions/${v.sessionId}/polish`, data: { formId: v.sessionFormId, answers: {} } },
    // packages / products
    { name: 'package PATCH', method: 'PATCH', path: `/api/packages/${v.packageId}`, data: { name: 'PWNED' } },
    { name: 'package DELETE', method: 'DELETE', path: `/api/packages/${v.packageId}` },
    { name: 'package clone POST', method: 'POST', path: `/api/packages/${v.packageId}/clone`, data: {} },
    { name: 'package session-plans GET', method: 'GET', path: `/api/trainer/packages/${v.packageId}/session-plans` },
    { name: 'package session-plans POST', method: 'POST', path: `/api/trainer/packages/${v.packageId}/session-plans`, data: { title: 'PWNED' } },
    { name: 'package default-homework GET', method: 'GET', path: `/api/trainer/packages/${v.packageId}/default-homework` },
    { name: 'package default-homework POST', method: 'POST', path: `/api/trainer/packages/${v.packageId}/default-homework`, data: { sessionNumber: 1, title: 'PWNED' } },
    { name: 'package comms-flow GET', method: 'GET', path: `/api/trainer/packages/${v.packageId}/comms-flow` },
    { name: 'product PATCH', method: 'PATCH', path: `/api/products/${v.productId}`, data: { name: 'PWNED' } },
    { name: 'product DELETE', method: 'DELETE', path: `/api/products/${v.productId}` },
    { name: 'product clone POST', method: 'POST', path: `/api/products/${v.productId}/clone`, data: {} },
    { name: 'product stock GET', method: 'GET', path: `/api/products/${v.productId}/stock` },
    { name: 'product stock POST', method: 'POST', path: `/api/products/${v.productId}/stock`, data: { delta: 5, reason: 'PWNED' } },
    { name: 'product variants GET', method: 'GET', path: `/api/products/${v.productId}/variants` },
    { name: 'product variants PUT', method: 'PUT', path: `/api/products/${v.productId}/variants`, data: { variants: [] } },
    { name: 'product category PATCH', method: 'PATCH', path: `/api/products/categories/${v.productCategoryId}`, data: { name: 'PWNED' } },
    { name: 'product category DELETE', method: 'DELETE', path: `/api/products/categories/${v.productCategoryId}` },
    // classes
    { name: 'class-run GET', method: 'GET', path: `/api/class-runs/${v.classRunId}` },
    { name: 'class-run PATCH', method: 'PATCH', path: `/api/class-runs/${v.classRunId}`, data: { name: 'PWNED' } },
    { name: 'class-run DELETE', method: 'DELETE', path: `/api/class-runs/${v.classRunId}` },
    { name: 'class-run enrollments POST', method: 'POST', path: `/api/class-runs/${v.classRunId}/enrollments`, data: { clientId: v.clientId, dogId: v.dogId, type: 'FULL' } },
    { name: 'class-run convert POST', method: 'POST', path: `/api/class-runs/${v.classRunId}/convert`, data: {} },
    { name: 'class-run comms-flow GET', method: 'GET', path: `/api/trainer/class-runs/${v.classRunId}/comms-flow` },
    // memberships
    { name: 'membership GET', method: 'GET', path: `/api/trainer/memberships/${v.membershipId}` },
    { name: 'membership PATCH', method: 'PATCH', path: `/api/trainer/memberships/${v.membershipId}`, data: { name: 'PWNED' } },
    { name: 'membership DELETE', method: 'DELETE', path: `/api/trainer/memberships/${v.membershipId}` },
    { name: 'membership invites GET', method: 'GET', path: `/api/trainer/memberships/${v.membershipId}/invites` },
    { name: 'membership comms-flow GET', method: 'GET', path: `/api/trainer/memberships/${v.membershipId}/comms-flow` },
    // forms
    { name: 'unified form GET', method: 'GET', path: `/api/forms/${v.formId}` },
    { name: 'unified form PATCH', method: 'PATCH', path: `/api/forms/${v.formId}`, data: { name: 'PWNED' } },
    { name: 'unified form DELETE', method: 'DELETE', path: `/api/forms/${v.formId}` },
    { name: 'unified form duplicate POST', method: 'POST', path: `/api/forms/${v.formId}/duplicate`, data: {} },
    { name: 'embed-form PATCH', method: 'PATCH', path: `/api/embed-forms/${v.embedFormId}`, data: { title: 'PWNED' } },
    { name: 'embed-form DELETE', method: 'DELETE', path: `/api/embed-forms/${v.embedFormId}` },
    { name: 'session-form PATCH', method: 'PATCH', path: `/api/session-forms/${v.sessionFormId}`, data: { name: 'PWNED' } },
    { name: 'session-form DELETE', method: 'DELETE', path: `/api/session-forms/${v.sessionFormId}` },
    // library
    { name: 'library type PATCH', method: 'PATCH', path: `/api/library/types/${v.libTypeId}`, data: { name: 'PWNED' } },
    { name: 'library type DELETE', method: 'DELETE', path: `/api/library/types/${v.libTypeId}` },
    { name: 'library theme PATCH', method: 'PATCH', path: `/api/library/themes/${v.themeId}`, data: { name: 'PWNED' } },
    { name: 'library theme DELETE', method: 'DELETE', path: `/api/library/themes/${v.themeId}` },
    { name: 'library task PATCH', method: 'PATCH', path: `/api/library/tasks/${v.libTaskId}`, data: { title: 'PWNED' } },
    { name: 'library task DELETE', method: 'DELETE', path: `/api/library/tasks/${v.libTaskId}` },
    { name: 'library task clone POST', method: 'POST', path: `/api/library/tasks/${v.libTaskId}/clone`, data: {} },
    { name: 'library task assign POST', method: 'POST', path: `/api/library/tasks/${v.libTaskId}/assign`, data: { clientIds: [v.clientId], date: iso } },
    // homework
    { name: 'task PATCH', method: 'PATCH', path: `/api/tasks/${v.homeworkId}`, data: { title: 'PWNED' } },
    { name: 'task DELETE', method: 'DELETE', path: `/api/tasks/${v.homeworkId}` },
    { name: 'task complete POST', method: 'POST', path: `/api/tasks/${v.homeworkId}/complete`, data: {} },
    { name: 'task logs POST', method: 'POST', path: `/api/tasks/${v.homeworkId}/logs`, data: { note: 'PWNED' } },
    // money
    { name: 'receivable GET', method: 'GET', path: `/api/trainer/finances/receivables/${v.invoiceId}` },
    { name: 'receivable PATCH', method: 'PATCH', path: `/api/trainer/finances/receivables/${v.invoiceId}`, data: { description: 'PWNED' } },
    { name: 'receivable record-payment POST', method: 'POST', path: `/api/trainer/finances/receivables/${v.invoiceId}/record-payment`, data: { amountCents: 1 } },
    { name: 'receivable send POST', method: 'POST', path: `/api/trainer/finances/receivables/${v.invoiceId}/send`, data: {} },
    { name: 'receivable request-payment POST', method: 'POST', path: `/api/trainer/finances/receivables/${v.invoiceId}/request-payment`, data: {} },
    // settings + everything else with an id
    { name: 'tag PATCH', method: 'PATCH', path: `/api/tags/${v.tagId}`, data: { name: 'PWNED' } },
    { name: 'tag DELETE', method: 'DELETE', path: `/api/tags/${v.tagId}` },
    { name: 'custom-field PUT', method: 'PUT', path: `/api/custom-fields/${v.customFieldId}`, data: { label: 'PWNED', type: 'TEXT' } },
    { name: 'custom-field DELETE', method: 'DELETE', path: `/api/custom-fields/${v.customFieldId}` },
    { name: 'achievement PATCH', method: 'PATCH', path: `/api/achievements/${v.achievementId}`, data: { name: 'PWNED' } },
    { name: 'achievement DELETE', method: 'DELETE', path: `/api/achievements/${v.achievementId}` },
    { name: 'email-template PATCH', method: 'PATCH', path: `/api/email-templates/${v.emailTemplateId}`, data: { name: 'PWNED' } },
    { name: 'email-template DELETE', method: 'DELETE', path: `/api/email-templates/${v.emailTemplateId}` },
    { name: 'enquiry GET', method: 'GET', path: `/api/enquiries/${v.enquiryId}` },
    { name: 'enquiry accept POST', method: 'POST', path: `/api/enquiries/${v.enquiryId}/accept`, data: {} },
    { name: 'enquiry decline POST', method: 'POST', path: `/api/enquiries/${v.enquiryId}/decline`, data: {} },
    { name: 'enquiry reply POST', method: 'POST', path: `/api/enquiries/${v.enquiryId}/reply`, data: { subject: 'x', body: 'PWNED' } },
    { name: 'waitlist PATCH', method: 'PATCH', path: `/api/waitlist/${v.waitlistId}`, data: { name: 'PWNED' } },
    { name: 'waitlist DELETE', method: 'DELETE', path: `/api/waitlist/${v.waitlistId}` },
    { name: 'discount PATCH', method: 'PATCH', path: `/api/trainer/discounts/${v.discountId}`, data: { name: 'PWNED' } },
    { name: 'discount DELETE', method: 'DELETE', path: `/api/trainer/discounts/${v.discountId}` },
    { name: 'location PATCH', method: 'PATCH', path: `/api/trainer/locations/${v.locationId}`, data: { name: 'PWNED' } },
    { name: 'location DELETE', method: 'DELETE', path: `/api/trainer/locations/${v.locationId}` },
    { name: 'booking-page PATCH', method: 'PATCH', path: `/api/trainer/booking-pages/${v.bookingPageId}`, data: { name: 'PWNED' } },
    { name: 'booking-page DELETE', method: 'DELETE', path: `/api/trainer/booking-pages/${v.bookingPageId}` },
    { name: 'booking-page automations GET', method: 'GET', path: `/api/trainer/booking-pages/${v.bookingPageId}/automations` },
    { name: 'availability PATCH', method: 'PATCH', path: `/api/availability/${v.availabilityId}`, data: { startTime: '00:00', endTime: '01:00' } },
    { name: 'availability DELETE', method: 'DELETE', path: `/api/availability/${v.availabilityId}` },
    { name: 'blackout DELETE', method: 'DELETE', path: `/api/blackouts/${v.blackoutId}` },
    { name: 'comms-flow-template DELETE', method: 'DELETE', path: `/api/trainer/comms-flow-templates/${v.commsTemplateId}` },
    { name: 'training template PUT', method: 'PUT', path: `/api/templates/${v.trainingTemplateId}`, data: { name: 'PWNED', tasks: [] } },
    { name: 'training template apply POST', method: 'POST', path: `/api/templates/${v.trainingTemplateId}/apply`, data: { clientId: v.clientId, startDate: iso } },
    { name: 'time-rate PATCH', method: 'PATCH', path: `/api/time-rates/${v.timeRateId}`, data: { name: 'PWNED' } },
    { name: 'time-rate DELETE', method: 'DELETE', path: `/api/time-rates/${v.timeRateId}` },
    { name: 'todo PATCH', method: 'PATCH', path: `/api/todos/${v.todoId}`, data: { title: 'PWNED' } },
    { name: 'todo DELETE', method: 'DELETE', path: `/api/todos/${v.todoId}` },
  ]
}

// Routes that deliberately answer 200 with an EMPTY payload rather than 404,
// because the screen renders nothing instead of an error. Documented in the
// route source; listed here so the matrix stays honest about the exception
// instead of quietly allowing every 200.
const EMPTY_PAYLOAD_OK = new Set([
  '/api/sessions/:id/series-step GET',
  '/api/sessions/:id/default-homework GET',
])

test.describe('security audit — cross-tenant matrix over every :id route', () => {
  let prisma: PrismaClient
  let victim: Victim

  test.beforeAll(async () => {
    prisma = makePrisma()
    await removeVictim(prisma) // idempotent: clear a half-finished earlier run
    victim = await victimFixtures(prisma)
  })

  test.afterAll(async () => {
    await removeVictim(prisma)
    await prisma.$disconnect()
  })

  test('Business A cannot touch a single one of the victim business’s records', async ({ page }) => {
    test.setTimeout(300_000)
    await login(page, SEED.owner.email, SEED.owner.password)

    const leaks: string[] = []
    const errors: string[] = []
    for (const p of crossTenantProbes(victim)) {
      const res = await page.request.fetch(p.path, {
        method: p.method,
        data: p.data as never,
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      if (res.status() >= 500) errors.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
      else if (!refused(res)) leaks.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
    }

    expect(errors, 'a cross-tenant id must never 500 — that is an unguarded query blowing up').toEqual([])
    expect(leaks, 'every cross-tenant id must be refused').toEqual([])
  })

  test('nothing the attacker sent was written to the victim’s rows', async () => {
    const [client, pkg, product, session, tag, form, task, membership, run, invoice] = await Promise.all([
      prisma.clientProfile.findUnique({ where: { id: victim.clientId }, select: { id: true, trainerId: true } }),
      prisma.package.findUnique({ where: { id: victim.packageId }, select: { name: true } }),
      prisma.product.findUnique({ where: { id: victim.productId }, select: { name: true } }),
      prisma.trainingSession.findUnique({ where: { id: victim.sessionId }, select: { title: true } }),
      prisma.tag.findUnique({ where: { id: victim.tagId }, select: { name: true } }),
      prisma.form.findUnique({ where: { id: victim.formId }, select: { name: true } }),
      prisma.trainingTask.findUnique({ where: { id: victim.homeworkId }, select: { title: true } }),
      prisma.membership.findUnique({ where: { id: victim.membershipId }, select: { name: true } }),
      prisma.classRun.findUnique({ where: { id: victim.classRunId }, select: { name: true } }),
      prisma.invoice.findUnique({ where: { id: victim.invoiceId }, select: { description: true } }),
    ])

    // Still there…
    expect(client, 'victim client survived').not.toBeNull()
    expect(client!.trainerId, 'victim client stayed in its own business').toBe(victim.trainerId)
    // …and unrenamed.
    for (const [what, value] of [
      ['package', pkg?.name], ['product', product?.name], ['session', session?.title],
      ['tag', tag?.name], ['form', form?.name], ['homework', task?.title],
      ['membership', membership?.name], ['class run', run?.name], ['invoice', invoice?.description],
    ] as const) {
      expect(value, `${what} must not have been renamed by the attacker`).not.toContain('PWNED')
    }

    // No dog, media or task was planted on the victim's client.
    const plantedDogs = await prisma.dog.count({ where: { clientProfileId: victim.clientId, name: { contains: 'PWNED' } } })
    expect(plantedDogs, 'no dog planted on the victim client').toBe(0)
    const plantedTasks = await prisma.trainingTask.count({ where: { clientId: victim.clientId, title: { contains: 'PWNED' } } })
    expect(plantedTasks, 'no homework planted on the victim client').toBe(0)
  })

  test('the 200-with-empty-payload exceptions really are empty', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    // These two answer 200 by design so the screen renders nothing rather than
    // erroring. They must still carry no data about the other business.
    const step = await page.request.get(`/api/sessions/${victim.sessionId}/series-step`, { failOnStatusCode: false })
    if (step.status() === 200) {
      const b = await step.json()
      expect(b.isSeries, 'foreign session must not be described as a series').toBeFalsy()
      expect(b.step, 'foreign session must expose no step').toBeNull()
      expect(b.packageName, 'foreign session must not name the other business’s offering').toBeUndefined()
    }
    const hw = await page.request.get(`/api/sessions/${victim.sessionId}/default-homework`, { failOnStatusCode: false })
    if (hw.status() === 200) {
      const b = await hw.json()
      expect(b.tasks, 'foreign session must suggest no homework').toEqual([])
      expect(b.recipients, 'foreign session must name no recipients').toEqual([])
      expect(b.packageId, 'foreign session must not name an offering').toBeNull()
    }
    expect(EMPTY_PAYLOAD_OK.size, 'keep the documented exception list short').toBeLessThanOrEqual(2)
  })
})

test.describe('security audit — a client cannot cross into another business', () => {
  let prisma: PrismaClient
  let victim: Victim

  test.beforeAll(async () => {
    prisma = makePrisma()
    await removeVictim(prisma)
    victim = await victimFixtures(prisma)
  })
  test.afterAll(async () => {
    await removeVictim(prisma)
    await prisma.$disconnect()
  })

  test('a signed-in client is refused every foreign-business self-service route', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page, SEED.client.email, SEED.client.password)

    const probes: Probe[] = [
      { name: 'buy foreign product', method: 'POST', path: `/api/my/products/${victim.productId}/buy`, data: {} },
      { name: 'request foreign product', method: 'POST', path: `/api/my/products/${victim.productId}/request`, data: {} },
      { name: 'enrol in foreign class', method: 'POST', path: `/api/my/classes/${victim.classRunId}/enroll`, data: { type: 'FULL' } },
      { name: 'cancel foreign class', method: 'POST', path: `/api/my/classes/${victim.classRunId}/cancel`, data: {} },
      { name: 'buy foreign membership', method: 'POST', path: `/api/my/memberships/${victim.membershipId}/buy`, data: {} },
      { name: 'request foreign membership', method: 'POST', path: `/api/my/memberships/${victim.membershipId}/request`, data: {} },
      { name: 'switch to foreign membership', method: 'POST', path: `/api/my/memberships/${victim.membershipId}/switch`, data: {} },
      { name: 'cancel foreign session', method: 'POST', path: `/api/my/sessions/${victim.sessionId}/cancel`, data: {} },
      { name: 'basket with foreign product', method: 'POST', path: '/api/my/basket/checkout', data: { lines: [{ kind: 'PRODUCT', key: 'k', productId: victim.productId, quantity: 1 }] } },
    ]

    const leaks: string[] = []
    for (const p of probes) {
      const res = await page.request.fetch(p.path, { method: p.method, data: p.data as never, maxRedirects: 0, failOnStatusCode: false })
      if (!refused(res)) leaks.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
    }
    expect(leaks, 'a client must never reach another business’s catalogue').toEqual([])
  })

  test('a client cannot reach the trainer API of their own business', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password)
    const trainerOnly: Probe[] = [
      { name: 'client list', method: 'GET', path: '/api/clients' },
      { name: 'packages', method: 'GET', path: '/api/packages' },
      { name: 'receivables', method: 'GET', path: '/api/trainer/finances/receivables' },
      { name: 'enquiries', method: 'GET', path: '/api/enquiries' },
      { name: 'trainer profile', method: 'GET', path: '/api/trainer/profile' },
      { name: 'trainer profile write', method: 'PATCH', path: '/api/trainer/profile', data: { businessName: 'PWNED' } },
      { name: 'team', method: 'GET', path: '/api/trainer/team' },
      { name: 'library tasks', method: 'GET', path: '/api/library/tasks' },
      { name: 'own client record write', method: 'PATCH', path: `/api/clients/${SEED.assignedClientId}`, data: { name: 'PWNED' } },
    ]
    const leaks: string[] = []
    for (const p of trainerOnly) {
      const res = await page.request.fetch(p.path, { method: p.method, data: p.data as never, maxRedirects: 0, failOnStatusCode: false })
      if (!refused(res)) leaks.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
    }
    expect(leaks, 'the trainer API is not a client API').toEqual([])
  })

  test('a client cannot set their own price, quantity or discount', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password)
    const bad = [
      { name: 'negative quantity', data: { lines: [{ kind: 'PRODUCT', key: 'k', productId: SEED.businessB.packageId, quantity: -5 }] } },
      { name: 'zero quantity', data: { lines: [{ kind: 'PRODUCT', key: 'k', productId: SEED.businessB.packageId, quantity: 0 }] } },
      { name: 'absurd quantity', data: { lines: [{ kind: 'PRODUCT', key: 'k', productId: SEED.businessB.packageId, quantity: 10_000_000 }] } },
      { name: 'empty basket', data: { lines: [] } },
    ]
    for (const b of bad) {
      const res = await page.request.post('/api/my/basket/checkout', { data: b.data, failOnStatusCode: false })
      expect(res.status(), `${b.name} must be rejected, never priced`).not.toBe(200)
      expect(res.status(), `${b.name} must not crash the route`).toBeLessThan(500)
    }
  })
})

test.describe('security audit — mass assignment', () => {
  test('a trainer cannot promote themselves or rewrite their own billing', async ({ page }) => {
    const prisma = makePrisma()
    try {
      await login(page, SEED.owner.email, SEED.owner.password)

      const before = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true, role: true } })
      await page.request.patch('/api/user', {
        data: { name: SEED.owner.name, role: 'ADMIN', isAdmin: true, emailVerified: '2020-01-01T00:00:00.000Z' },
        failOnStatusCode: false,
      })
      const afterUser = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { role: true } })
      expect(afterUser?.role, 'role is not settable from the request body').toBe(before?.role)

      const beforeProfile = await prisma.trainerProfile.findUnique({
        where: { userId: before!.id },
        select: { subscriptionStatus: true, stripeSubscriptionId: true, tapToPayEnabled: true, isInternal: true, connectChargesEnabled: true, seatCount: true, gracePeriodUntil: true, sandboxBilling: true, isFounder: true, acceptPaymentsEnabled: true },
      })
      await page.request.patch('/api/trainer/profile', {
        data: {
          businessName: SEED.owner.businessName,
          subscriptionStatus: 'ACTIVE', stripeSubscriptionId: 'sub_PWNED', tapToPayEnabled: true,
          isInternal: true, connectChargesEnabled: true, seatCount: 99,
          gracePeriodUntil: '2099-01-01T00:00:00.000Z', sandboxBilling: true, isFounder: true,
          acceptPaymentsEnabled: true,
        },
        failOnStatusCode: false,
      })
      const afterProfile = await prisma.trainerProfile.findUnique({
        where: { userId: before!.id },
        select: { subscriptionStatus: true, stripeSubscriptionId: true, tapToPayEnabled: true, isInternal: true, connectChargesEnabled: true, seatCount: true, gracePeriodUntil: true, sandboxBilling: true, isFounder: true, acceptPaymentsEnabled: true },
      })
      expect(afterProfile, 'no billing/entitlement field is settable from the request body').toEqual(beforeProfile)
    } finally {
      await prisma.$disconnect()
    }
  })

  test('a trainerId in the body cannot plant a row in another business', async ({ page }) => {
    const prisma = makePrisma()
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const rivalId = await prisma.trainerProfile.findFirst({ where: { slug: SEED.businessB.slug }, select: { id: true } })
      expect(rivalId, 'rival business exists in the seed').not.toBeNull()

      const attempts = [
        { path: '/api/products', data: { name: `${MARK} planted product`, priceCents: 100, trainerId: rivalId!.id } },
        { path: '/api/packages', data: { name: `${MARK} planted pkg`, sessionCount: 1, priceCents: 100, trainerId: rivalId!.id } },
        { path: '/api/tags', data: { name: `${MARK} planted tag`, trainerId: rivalId!.id } },
      ]
      for (const a of attempts) {
        await page.request.post(a.path, { data: a.data, failOnStatusCode: false })
      }

      const planted = await Promise.all([
        prisma.product.count({ where: { trainerId: rivalId!.id, name: { startsWith: MARK } } }),
        prisma.package.count({ where: { trainerId: rivalId!.id, name: { startsWith: MARK } } }),
        prisma.tag.count({ where: { trainerId: rivalId!.id, name: { startsWith: MARK } } }),
      ])
      expect(planted, 'a body trainerId must be ignored, never honoured').toEqual([0, 0, 0])

      // Anything that DID get created landed in the attacker's own business —
      // clean it up so later specs' counts don't move.
      const own = await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName }, select: { id: true } })
      if (own) {
        await prisma.product.deleteMany({ where: { trainerId: own.id, name: { startsWith: MARK } } })
        await prisma.package.deleteMany({ where: { trainerId: own.id, name: { startsWith: MARK } } })
        await prisma.tag.deleteMany({ where: { trainerId: own.id, name: { startsWith: MARK } } })
      }
    } finally {
      await prisma.$disconnect()
    }
  })
})

test.describe('security audit — admin surface', () => {
  const ADMIN_PROBES: Probe[] = [
    { name: 'admin trainers list', method: 'GET', path: '/api/admin/trainers' },
    { name: 'admin announcements list', method: 'GET', path: '/api/admin/announcements' },
    { name: 'admin announcement create', method: 'POST', path: '/api/admin/announcements', data: { title: 'x', bodyHtml: '<p>x</p>', audience: 'TRAINERS' } },
    { name: 'admin plans', method: 'GET', path: '/api/admin/plans' },
    { name: 'admin promo codes', method: 'GET', path: '/api/admin/promo-codes' },
    { name: 'admin trainer notes create', method: 'POST', path: '/api/admin/trainer-notes', data: { trainerId: 'x', body: 'x' } },
    { name: 'admin trainer tasks create', method: 'POST', path: '/api/admin/trainer-tasks', data: { trainerId: 'x', title: 'x' } },
    { name: 'admin demo reset', method: 'POST', path: '/api/admin/demo/reset', data: {} },
    { name: 'admin demo seed', method: 'POST', path: '/api/admin/demo/seed', data: {} },
    { name: 'admin onboarding step patch', method: 'PATCH', path: '/api/admin/onboarding-steps/anything', data: { title: 'x' } },
    { name: 'admin billing item patch', method: 'PATCH', path: '/api/admin/billing-items/anything', data: { priceCents: 1 } },
  ]

  test('a normal trainer reaches none of /api/admin', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page, SEED.owner.email, SEED.owner.password)
    const leaks: string[] = []
    for (const p of ADMIN_PROBES) {
      const res = await page.request.fetch(p.path, { method: p.method, data: p.data as never, maxRedirects: 0, failOnStatusCode: false })
      if (!refused(res)) leaks.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
    }
    expect(leaks, 'the admin API is not a trainer API').toEqual([])
  })

  test('a client reaches none of /api/admin either', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page, SEED.client.email, SEED.client.password)
    const leaks: string[] = []
    for (const p of ADMIN_PROBES) {
      const res = await page.request.fetch(p.path, { method: p.method, data: p.data as never, maxRedirects: 0, failOnStatusCode: false })
      if (!refused(res)) leaks.push(`${p.method} ${p.path} → ${res.status()} (${p.name})`)
    }
    expect(leaks, 'the admin API is not a client API').toEqual([])
  })

  test('impersonation is admin-only', async ({ page }) => {
    const prisma = makePrisma()
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const rival = await prisma.trainerProfile.findFirst({ where: { slug: SEED.businessB.slug }, select: { id: true } })
      const res = await page.request.get(`/api/admin/impersonate/${rival!.id}`, { maxRedirects: 0, failOnStatusCode: false })
      expect(refused(res), 'a trainer must not be able to impersonate another business').toBe(true)
    } finally {
      await prisma.$disconnect()
    }
  })
})

test.describe('security audit — session revocation', () => {
  // FINDING (see docs/audit-security.md): sessions are stateless JWTs with a
  // 365-day maxAge and no server-side store or token version, so NOTHING
  // revokes one. Signing out clears the cookie in the browser; a captured
  // cookie keeps working. Rotating the password keeps it working. An admin
  // "Deactivate" keeps it working.
  //
  // All three expect the CORRECT behaviour and are marked failing, so they turn
  // green as soon as a revocation mechanism lands (a token version on User
  // checked in the jwt callback is the small fix).

  test.fail(true, 'known finding — stateless JWT, nothing revokes a live session')
  test('signing out invalidates the token, not just the cookie', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, SEED.owner.email, SEED.owner.password)

    const stolen = await ctx.cookies()
    const alive = await page.request.get('/api/clients')
    expect(alive.status(), 'signed in and working').toBe(200)

    await page.goto('/logout')
    await page.waitForURL(u => u.pathname.startsWith('/login') || u.pathname.startsWith('/welcome'), { timeout: 30_000 })

    // Replay the captured cookie in a brand-new context — this is exactly what
    // an attacker holding a stolen session cookie does.
    const replayCtx = await browser.newContext()
    await replayCtx.addCookies(stolen)
    const replay = await replayCtx.request.get('/api/clients', { maxRedirects: 0, failOnStatusCode: false })
    await replayCtx.close()
    await ctx.close()

    expect(replay.status(), 'a signed-out session cookie must no longer work').not.toBe(200)
  })

  test.fail(true, 'known finding — a password change does not revoke live sessions')
  test('changing the password invalidates existing sessions', async ({ browser }) => {
    const prisma = makePrisma()
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await login(page, SEED.owner.email, SEED.owner.password)
      expect((await page.request.get('/api/clients')).status()).toBe(200)

      const user = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      const account = await prisma.account.findFirst({ where: { userId: user!.id, provider: 'credentials' }, select: { id: true, providerAccountId: true } })
      const original = account!.providerAccountId
      await prisma.account.update({ where: { id: account!.id }, data: { providerAccountId: await bcrypt.hash('SomethingElse!2026', 10) } })
      try {
        const after = await page.request.get('/api/clients', { maxRedirects: 0, failOnStatusCode: false })
        expect(after.status(), 'the old session must die with the old password').not.toBe(200)
      } finally {
        await prisma.account.update({ where: { id: account!.id }, data: { providerAccountId: original } })
      }
    } finally {
      await ctx.close()
      await prisma.$disconnect()
    }
  })

  test.fail(true, 'known finding — deactivation is not enforced on the request path')
  test('deactivating an account locks its live session out', async ({ browser }) => {
    const prisma = makePrisma()
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await login(page, SEED.owner.email, SEED.owner.password)
      expect((await page.request.get('/api/clients')).status()).toBe(200)

      const user = await prisma.user.findUnique({ where: { email: SEED.owner.email }, select: { id: true } })
      await prisma.user.update({ where: { id: user!.id }, data: { deactivatedAt: new Date() } })
      try {
        const after = await page.request.get('/api/clients', { maxRedirects: 0, failOnStatusCode: false })
        expect(after.status(), 'a deactivated account must not keep serving its client list').not.toBe(200)
      } finally {
        await prisma.user.update({ where: { id: user!.id }, data: { deactivatedAt: null } })
      }
    } finally {
      await ctx.close()
      await prisma.$disconnect()
    }
  })
})

test.describe('security audit — client sharing', () => {
  let prisma: PrismaClient
  let victim: Victim

  test.beforeAll(async () => {
    prisma = makePrisma()
    await removeVictim(prisma)
    victim = await victimFixtures(prisma)
  })
  test.afterAll(async () => {
    await removeVictim(prisma)
    await prisma.$disconnect()
  })

  test('a trainer cannot share a client they do not own', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post(`/api/clients/${victim.clientId}/share`, {
      data: { partnerEmail: SEED.owner.email, shareType: 'TRANSFER' },
      failOnStatusCode: false,
    })
    expect(refused(res), 'sharing someone else’s client must be refused').toBe(true)

    const still = await prisma.clientProfile.findUnique({ where: { id: victim.clientId }, select: { trainerId: true } })
    expect(still?.trainerId, 'the victim client must not have been transferred').toBe(victim.trainerId)
    const shares = await prisma.clientShare.count({ where: { clientId: victim.clientId } })
    expect(shares, 'no share row may be created for a client you do not own').toBe(0)
  })

  // FINDING (see docs/audit-security.md): a share, once created, is permanent.
  // There is no trainer-facing route or UI to withdraw it — the only deleteMany
  // in the codebase is inside admin account deletion. Access grants must be
  // revocable. Expects the correct behaviour, so it goes green on the fix.
  test.fail(true, 'known finding — no route exists to withdraw a client share')
  test('a client share can be withdrawn again', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Owner A shares their own assigned client with the victim business.
    const share = await page.request.post(`/api/clients/${SEED.assignedClientId}/share`, {
      data: { partnerEmail: `${MARK}-victim-owner@e2e.test`, shareType: 'READ_ONLY' },
      failOnStatusCode: false,
    })
    expect(share.status(), 'sharing your own client is allowed').toBeLessThan(400)

    const created = await prisma.clientShare.findFirst({
      where: { clientId: SEED.assignedClientId, sharedWithId: victim.trainerId },
      select: { id: true },
    })
    expect(created, 'the share was created').not.toBeNull()

    const revoke = await page.request.delete(`/api/clients/${SEED.assignedClientId}/share/${created!.id}`, { failOnStatusCode: false })
    expect(revoke.status(), 'a share must be withdrawable by the business that made it').toBeLessThan(400)

    const after = await prisma.clientShare.count({ where: { id: created!.id } })
    expect(after, 'the withdrawn share is gone').toBe(0)
  })
})

test.describe('security audit — trainer profile response shape', () => {
  // FINDING (see docs/audit-security.md): GET /api/trainer/profile returns the
  // whole TrainerProfile row — including googleCalendarRefreshToken, a live
  // Google OAuth refresh token — to ANY signed-in member of the business,
  // including a STAFF member with no settings permission. The route should
  // `select` the fields the settings screen needs.
  //
  // Expects the CORRECT behaviour, so it fails today and passes once fixed.
  test.fail(true, 'known finding — the route has no `select`, so secrets ride along')
  test('the profile endpoint does not hand out stored credentials', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.get('/api/trainer/profile')
    expect(res.status()).toBe(200)
    const body = await res.json()
    for (const secret of ['googleCalendarRefreshToken', 'stripeCustomerId', 'stripeSubscriptionId', 'resendDomainId', 'connectAccountId']) {
      expect(Object.keys(body), `${secret} must not be in the settings payload`).not.toContain(secret)
    }
  })
})
