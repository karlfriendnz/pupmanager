/**
 * SECURITY AUDIT fixture seeder — LOCAL DEV DB ONLY.
 * Creates two isolated trainer businesses (A and B) each with a client, dog,
 * package, product, session, invoice, tag, form, library content.
 * Everything is prefixed `secaudit-` so it can be removed by audit-sec-clean.ts.
 *
 * Run: dotenv -e .env.development.local -o -- npx tsx scripts/audit-sec-seed.ts
 */
import { scriptPrisma } from '../src/lib/prisma-script'
import bcrypt from 'bcryptjs'
import fs from 'fs'

const prisma = scriptPrisma()
const PW = 'AuditPass!2026x'
const MARK = 'secaudit'

async function makeTrainer(tag: string, biz: string) {
  const email = `${MARK}-trainer-${tag}@example.test`
  const user = await prisma.user.create({
    data: {
      email,
      name: `Audit Trainer ${tag.toUpperCase()}`,
      role: 'TRAINER',
      emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: await bcrypt.hash(PW, 10) } },
    },
  })
  const profile = await prisma.trainerProfile.create({
    data: {
      userId: user.id,
      businessName: biz,
      slug: `${MARK}-${tag}`,
      phone: '+64211111111',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: new Date(Date.now() + 365 * 864e5),
    },
  })
  await prisma.trainerMembership.create({
    data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
  })
  return { user, profile, email, password: PW }
}

async function makeClient(tag: string, trainerId: string) {
  const email = `${MARK}-client-${tag}@example.test`
  const user = await prisma.user.create({
    data: {
      email,
      name: `Audit Client ${tag.toUpperCase()}`,
      role: 'CLIENT',
      emailVerified: new Date(),
      accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: await bcrypt.hash(PW, 10) } },
    },
  })
  const dog = await prisma.dog.create({ data: { name: `Dog-${tag}`, breed: 'Labrador' } })
  const profile = await prisma.clientProfile.create({
    data: { userId: user.id, trainerId, dogId: dog.id, phone: '+6421222222' },
  })
  await prisma.dog.update({ where: { id: dog.id }, data: { clientProfileId: profile.id } })
  return { user, profile, dog, email, password: PW }
}

async function tenantData(tag: string, trainerId: string, clientId: string, dogId: string) {
  const pkg = await prisma.package.create({
    data: { trainerId, name: `${MARK} pkg ${tag}`, description: `<p>secret ${tag}</p>`, priceCents: 10000, sessionCount: 3 },
  })
  const product = await prisma.product.create({
    data: { trainerId, name: `${MARK} product ${tag}`, priceCents: 5000, active: true },
  })
  const session = await prisma.trainingSession.create({
    data: {
      trainerId, clientId, dogId,
      title: `${MARK} session ${tag}`,
      scheduledAt: new Date(Date.now() + 86400000),
      durationMins: 60,
      description: `PRIVATE NOTE ${tag}`,
    },
  })
  const invoice = await prisma.invoice.create({
    data: { trainerId, clientId, amountCents: 12345, currency: 'NZD', description: `${MARK} invoice ${tag}`, status: 'UNPAID' },
  })
  const tagRow = await prisma.tag.create({
    data: { trainerId, name: `${MARK}-tag-${tag}`, nameKey: `${MARK}-tag-${tag}` },
  })
  const form = await prisma.form.create({
    data: {
      trainerId, name: `${MARK} form ${tag}`, usableAsEnquiry: true, slug: `${MARK}-form-${tag}`,
      questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'Your name', required: false }],
    },
  })
  const libType = await prisma.libraryType.create({ data: { trainerId, name: `${MARK} type ${tag}` } })
  const theme = await prisma.libraryTheme.create({ data: { typeId: libType.id, name: `${MARK} theme ${tag}` } })
  const libTask = await prisma.libraryTask.create({ data: { typeId: libType.id, themeId: theme.id, title: `${MARK} libtask ${tag}`, description: `<p>secret lib ${tag}</p>` } })

  const classRun = await prisma.classRun.create({
    data: { trainerId, packageId: pkg.id, name: `${MARK} run ${tag}`, startDate: new Date(Date.now() + 7 * 864e5), capacity: 6 },
  })
  const membership = await prisma.membership.create({
    data: { trainerId, name: `${MARK} membership ${tag}`, priceCents: 9900, published: true, slug: `${MARK}-mem-${tag}` },
  })
  const location = await prisma.location.create({ data: { trainerId, name: `${MARK} location ${tag}` } })
  const customField = await prisma.customField.create({ data: { trainerId, label: `${MARK} field ${tag}`, type: 'TEXT' } })
  const achievement = await prisma.achievement.create({ data: { trainerId, name: `${MARK} award ${tag}` } })
  const emailTemplate = await prisma.emailTemplate.create({ data: { trainerId, name: `${MARK} tmpl ${tag}`, subject: 'S', body: 'B' } })
  const sessionForm = await prisma.sessionForm.create({ data: { trainerId, name: `${MARK} sform ${tag}` } })
  const embedForm = await prisma.embedForm.create({ data: { trainerId, title: `${MARK} embed ${tag}` } })
  const enquiry = await prisma.enquiry.create({ data: { trainerId, name: `${MARK} enquiry ${tag}`, email: `enq-${tag}@example.test`, message: `SECRET ENQUIRY ${tag}` } })
  const waitlist = await prisma.waitlistEntry.create({ data: { trainerId, name: `${MARK} wait ${tag}`, email: `w-${tag}@example.test` } })
  const discount = await prisma.discount.create({ data: { trainerId, name: `${MARK} disc ${tag}`, modifierType: 'PERCENT', modifierValue: 10 } })
  const bookingPage = await prisma.bookingPage.create({ data: { trainerId, slug: `${MARK}-bp-${tag}`, name: `${MARK} bp ${tag}`, enabled: true } })
  const availability = await prisma.availabilitySlot.create({ data: { trainerId, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' } })
  const blackout = await prisma.blackoutPeriod.create({ data: { trainerId, startDate: new Date(), endDate: new Date(Date.now() + 864e5), reason: `${MARK} bo ${tag}` } })
  const productCategory = await prisma.productCategory.create({ data: { trainerId, name: `${MARK} cat ${tag}` } })
  const commsTemplate = await prisma.commsFlowTemplate.create({ data: { trainerId, name: `${MARK} cft ${tag}` } })
  const trainingTemplate = await prisma.trainingTemplate.create({ data: { trainerId, name: `${MARK} ttmpl ${tag}` } }).catch(() => null)
  const timeRate = await prisma.timeRate.create({ data: { companyId: trainerId, name: `${MARK} rate ${tag}`, rateCents: 5000 } })
  const homework = await prisma.trainingTask.create({ data: { clientId, dogId, sessionId: session.id, date: new Date(), title: `${MARK} homework ${tag}`, description: `<p>secret hw ${tag}</p>` } })
  const clientPackage = await prisma.clientPackage.create({ data: { packageId: pkg.id, clientId, startDate: new Date() } })

  return {
    pkg, product, session, invoice, tag: tagRow, form, theme, libTask, libType,
    classRun, membership, location, customField, achievement, emailTemplate, sessionForm,
    embedForm, enquiry, waitlist, discount, bookingPage, availability, blackout,
    productCategory, commsTemplate, trainingTemplate, timeRate, homework, clientPackage,
  }
}

async function main() {
  if (!process.env.DATABASE_URL?.includes('localhost')) {
    throw new Error('Refusing to run: DATABASE_URL is not localhost — ' + process.env.DATABASE_URL)
  }
  const A = await makeTrainer('a', 'Audit Alpha Dogs')
  const B = await makeTrainer('b', 'Audit Bravo Dogs')
  const CA = await makeClient('a', A.profile.id)
  const CB = await makeClient('b', B.profile.id)
  const DA = await tenantData('a', A.profile.id, CA.profile.id, CA.dog.id)
  const DB = await tenantData('b', B.profile.id, CB.profile.id, CB.dog.id)

  const out = {
    password: PW,
    A: { email: A.email, userId: A.user.id, trainerId: A.profile.id, slug: A.profile.slug, data: ids(DA), client: { email: CA.email, userId: CA.user.id, clientId: CA.profile.id, dogId: CA.dog.id } },
    B: { email: B.email, userId: B.user.id, trainerId: B.profile.id, slug: B.profile.slug, data: ids(DB), client: { email: CB.email, userId: CB.user.id, clientId: CB.profile.id, dogId: CB.dog.id } },
  }
  fs.writeFileSync(process.env.AUDIT_FIXTURE_PATH || '/tmp/audit-fixture.json', JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}

function ids(d: any) {
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(d)) out[k] = (v as any)?.id ?? null
  return out
}

main().finally(() => prisma.$disconnect())
