// UX-audit only: create TWO throwaway trainers on the LOCAL dev DB —
//   1. a populated one (long business name, 3 clients, a 3-dog household,
//      a 40-session class, invoices) for layout/overflow stress, and
//   2. a brand-new empty one, for judging empty states.
// Purely additive: it never reads or writes another account's rows, so it is
// safe to run while other agents are using the same dev database.
// Run: npx dotenv -e .env.development.local -o -- npx tsx tests/audit/setup-ux.ts
import { scriptPrisma } from '../../src/lib/prisma-script'
import bcrypt from 'bcryptjs'

const prisma = scriptPrisma()

export const UX = {
  trainer: { email: 'audit.ux@pupaudit.test', password: 'AuditUx2026!' },
  empty: { email: 'audit.ux.empty@pupaudit.test', password: 'AuditUx2026!' },
  client: { email: 'audit.ux.client@pupaudit.test', password: 'AuditUx2026!' },
  // 60 characters exactly — the "long business name" stress case.
  businessName: 'Bark & Beyond Canine Behaviour & Rehabilitation Academy Ltd.',
}

async function credUser(email: string, name: string, role: 'TRAINER' | 'CLIENT', password: string) {
  const hash = await bcrypt.hash(password, 12)
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, role, emailVerified: new Date() },
    update: { name, role, emailVerified: new Date() },
  })
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })
  return user
}

const ADDONS: [string, string, number][] = [
  ['marketing', 'Marketing', 10],
  ['routeplanner', 'Route planner', 10],
  ['leadmagnets', 'Lead magnets', 10],
  ['timesheets', 'Timesheets', 0],
  ['todos', 'To-do & brain dump', 0],
  ['achievements', 'Client achievements', 19],
  ['shop', 'Client shop', 29],
  ['classes', 'Group classes', 0],
  ['events', 'Events', 0],
  ['dropins', 'Casual classes', 0],
  ['puppyschool', 'Doggy daycare', 0],
  ['memberships', 'Packages', 0],
]

async function enableAddons(trainerId: string) {
  for (const [id, name, priceMonthly] of ADDONS) {
    await prisma.billingItem.upsert({
      where: { id },
      update: { isActive: true },
      create: { id, kind: 'ADDON', name, description: name, priceMonthly, sortOrder: 10, isActive: true },
    })
    const existing = await prisma.trainerAddon.findFirst({ where: { trainerId, itemId: id } })
    if (!existing) {
      await prisma.trainerAddon.create({ data: { trainerId, itemId: id, active: true, grantedByAdmin: true } })
    }
  }
}

async function main() {
  const trial = new Date(Date.now() + 90 * 864e5)

  // ─── 1. The EMPTY trainer (brand-new account, for empty states) ──────────
  const emptyUser = await credUser(UX.empty.email, 'Ellie Empty', 'TRAINER', UX.empty.password)
  let emptyProfile = await prisma.trainerProfile.findFirst({ where: { userId: emptyUser.id } })
  if (!emptyProfile) {
    emptyProfile = await prisma.trainerProfile.create({
      data: { userId: emptyUser.id, businessName: 'Fresh Start Dog Co', phone: '+64 21 555 0100', trialEndsAt: trial },
    })
  }
  const emptyMember = await prisma.trainerMembership.findFirst({ where: { companyId: emptyProfile.id, userId: emptyUser.id } })
  if (!emptyMember) {
    await prisma.trainerMembership.create({
      data: { companyId: emptyProfile.id, userId: emptyUser.id, role: 'OWNER', acceptedAt: new Date() },
    })
  }
  await enableAddons(emptyProfile.id)

  // ─── 2. The POPULATED trainer ────────────────────────────────────────────
  const tUser = await credUser(UX.trainer.email, 'Uma Auditor', 'TRAINER', UX.trainer.password)
  let profile = await prisma.trainerProfile.findFirst({ where: { userId: tUser.id } })
  if (!profile) {
    profile = await prisma.trainerProfile.create({
      data: {
        userId: tUser.id,
        businessName: UX.businessName,
        slug: 'bark-and-beyond-audit',
        phone: '+64 21 555 0101',
        trialEndsAt: trial,
        subscriptionStatus: 'ACTIVE',
        emailAccentColor: '#0d9488',
      },
    })
  } else {
    profile = await prisma.trainerProfile.update({
      where: { id: profile.id },
      data: { businessName: UX.businessName, trialEndsAt: trial, subscriptionStatus: 'ACTIVE' },
    })
  }
  const member =
    (await prisma.trainerMembership.findFirst({ where: { companyId: profile.id, userId: tUser.id } })) ??
    (await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: tUser.id, role: 'OWNER', acceptedAt: new Date() },
    }))
  await enableAddons(profile.id)

  const trainerId = profile.id

  // ── Clients. One is the login for the client app, and has THREE dogs. ────
  const cUser = await credUser(UX.client.email, 'Charlotte Featherstone-Haugh', 'CLIENT', UX.client.password)
  let client = await prisma.clientProfile.findFirst({ where: { userId: cUser.id, trainerId } })
  if (!client) {
    client = await prisma.clientProfile.create({
      data: {
        userId: cUser.id, trainerId, status: 'ACTIVE', phone: '+64 21 555 0102',
        assignedMembershipId: member.id,
        addressLine: '128 Riverside Terrace, Grey Lynn, Auckland 1021, New Zealand',
      },
    })
  }
  const dogNames: [string, string][] = [
    ['Bartholomew', 'Bernese Mountain Dog'],
    ['Nutmeg', 'Cavalier King Charles Spaniel'],
    ['Rufus', 'Staffordshire Bull Terrier'],
  ]
  const dogIds: string[] = []
  for (const [name, breed] of dogNames) {
    const existing = await prisma.dog.findFirst({ where: { clientProfileId: client.id, name } })
    const dog = existing ?? (await prisma.dog.create({ data: { name, breed, clientProfileId: client.id } }))
    dogIds.push(dog.id)
  }
  if (!client.dogId) {
    client = await prisma.clientProfile.update({ where: { id: client.id }, data: { dogId: dogIds[0] } })
  }

  // Two more clients so lists have rows.
  for (const [email, name] of [
    ['audit.ux.c2@pupaudit.test', 'Tom Baker'],
    ['audit.ux.c3@pupaudit.test', 'Priya Ramanathan-Whitfield'],
  ] as const) {
    const u = await prisma.user.upsert({
      where: { email }, create: { email, name, role: 'CLIENT', emailVerified: new Date() }, update: { name },
    })
    const cp = await prisma.clientProfile.findFirst({ where: { userId: u.id, trainerId } })
    if (!cp) {
      const d = await prisma.dog.create({ data: { name: name.split(' ')[0] === 'Tom' ? 'Pixel' : 'Sunny', breed: 'Border Collie' } })
      await prisma.clientProfile.create({
        data: { userId: u.id, trainerId, status: 'ACTIVE', dogId: d.id, phone: '+64 21 555 0103' },
      })
    }
  }

  // ── Offerings ────────────────────────────────────────────────────────────
  let pkg = await prisma.package.findFirst({ where: { trainerId, name: 'Puppy Foundations' } })
  if (!pkg) {
    pkg = await prisma.package.create({
      data: {
        trainerId, name: 'Puppy Foundations', sessionCount: 4, weeksBetween: 1, priceCents: 32000,
        description: '<p>A four-week grounding in the basics: name response, sit, settle and loose-lead walking.</p>',
      },
    })
  }
  // A GROUP package with a 40-session run — the long-content stress case.
  let group = await prisma.package.findFirst({ where: { trainerId, name: 'Year-Long Reactive Rehab Programme' } })
  if (!group) {
    group = await prisma.package.create({
      data: {
        trainerId, name: 'Year-Long Reactive Rehab Programme', isGroup: true,
        sessionCount: 40, weeksBetween: 1, durationMins: 60, priceCents: 180000, capacity: 8,
      },
    })
  }
  let run = await prisma.classRun.findFirst({ where: { trainerId, name: 'Reactive Rehab — 2026 Cohort' } })
  if (!run) {
    const start = new Date(); start.setUTCHours(18, 0, 0, 0); start.setDate(start.getDate() - 70)
    run = await prisma.classRun.create({
      data: {
        trainerId, packageId: group.id, name: 'Reactive Rehab — 2026 Cohort',
        startDate: start, capacity: 8, scheduleNote: 'Tuesdays 6:00pm',
        location: 'The old showgrounds car park, 14 Marlborough Street, Ellerslie',
      },
    })
    const sessions = Array.from({ length: 40 }, (_, i) => {
      const at = new Date(start.getTime() + i * 7 * 864e5)
      return {
        trainerId, classRunId: run!.id, sessionIndex: i + 1,
        title: `Week ${i + 1} — ${i % 3 === 0 ? 'Distance work and threshold management' : 'Handling practice'}`,
        scheduledAt: at, durationMins: 60, location: run!.location,
        status: at < new Date() ? ('COMPLETED' as const) : ('UPCOMING' as const),
      }
    })
    await prisma.trainingSession.createMany({ data: sessions })
    await prisma.classEnrollment.create({
      data: { classRunId: run.id, clientId: client.id, dogId: dogIds[0], status: 'ENROLLED' },
    })
  }

  // ── 1:1 sessions for the client app ──────────────────────────────────────
  const has = await prisma.trainingSession.count({ where: { trainerId, clientId: client.id } })
  if (has === 0) {
    const soon = new Date(Date.now() + 2 * 864e5); soon.setHours(16, 0, 0, 0)
    const past = new Date(Date.now() - 5 * 864e5); past.setHours(10, 0, 0, 0)
    await prisma.trainingSession.create({
      data: { trainerId, clientId: client.id, dogId: dogIds[0], title: 'Loose-lead walking', scheduledAt: soon, durationMins: 60, location: 'Riverside Park', status: 'UPCOMING' },
    })
    await prisma.trainingSession.create({
      data: { trainerId, clientId: client.id, dogId: dogIds[0], title: 'Recall in distraction', scheduledAt: past, durationMins: 60, location: 'Riverside Park', status: 'COMPLETED' },
    })
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.trainingTask.createMany({
      data: [
        { clientId: client.id, dogId: dogIds[0], date: today, title: 'Sit-stay, build to 30 seconds', repetitions: 10, order: 0 },
        { clientId: client.id, dogId: dogIds[0], date: today, title: 'Loose-lead down the driveway and back, ten minutes', order: 1 },
      ],
    })
  }

  // ── Invoices, so money screens have rows of differing width ──────────────
  const invCount = await prisma.invoice.count({ where: { trainerId } })
  if (invCount === 0) {
    await prisma.invoice.create({
      data: {
        trainerId, clientId: client.id, amountCents: 32000, amountPaidCents: 0, currency: 'nzd',
        status: 'UNPAID', description: 'Puppy Foundations', sourceType: 'MANUAL', sentAt: new Date(),
        payToken: 'auditux0000000000000pay1',
        lines: { create: [{ description: 'Puppy Foundations', quantity: 1, unitAmountCents: 32000, amountCents: 32000, sortOrder: 0 }] },
      },
    })
    await prisma.invoice.create({
      data: {
        trainerId, clientId: client.id, amountCents: 180000, amountPaidCents: 60000, currency: 'nzd',
        status: 'PARTIAL', description: 'Year-Long Reactive Rehabilitation Programme with in-home follow-up visits',
        sourceType: 'MANUAL', sentAt: new Date(),
        lines: { create: [{ description: 'Reactive Rehab', quantity: 1, unitAmountCents: 180000, amountCents: 180000, sortOrder: 0 }] },
      },
    })
  }

  console.log(JSON.stringify({
    populated: { email: UX.trainer.email, password: UX.trainer.password, trainerId },
    empty: { email: UX.empty.email, password: UX.empty.password, trainerId: emptyProfile.id },
    client: { email: UX.client.email, password: UX.client.password, clientId: client.id },
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
