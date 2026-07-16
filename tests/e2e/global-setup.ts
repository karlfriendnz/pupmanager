// Boots a throwaway embedded Postgres, syncs the current Prisma schema onto it
// with `db push` (the migration history doesn't replay cleanly from zero — a
// known pre-existing drift — and tests don't need history), then seeds one
// owner trainer + a little data. The PG instance is stashed on globalThis so
// global-teardown can stop it.
import EmbeddedPostgres from 'embedded-postgres'
import { execSync } from 'node:child_process'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { TEST_DB, TEST_DATABASE_URL, SEED } from './test-db'

export default async function globalSetup() {
  // The seeding PrismaClient (below) reads DATABASE_URL at construction.
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DIRECT_URL = TEST_DATABASE_URL

  const pg = new EmbeddedPostgres({
    databaseDir: TEST_DB.dataDir,
    user: TEST_DB.user,
    password: TEST_DB.password,
    port: TEST_DB.port,
    persistent: false, // wipe the data dir on stop
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase(TEST_DB.database)
  ;(globalThis as unknown as { __E2E_PG__?: EmbeddedPostgres }).__E2E_PG__ = pg

  console.log('[e2e] embedded postgres up — pushing schema…')
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
  })

  // Seed an owner trainer (verified, with a credentials password) + an OWNER
  // membership + a sample client and package so specs have data to assign.
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
  try {
    const hash = await bcrypt.hash(SEED.owner.password, 12)
    const user = await prisma.user.create({
      data: {
        email: SEED.owner.email,
        name: SEED.owner.name,
        role: 'TRAINER',
        emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: hash } },
      },
    })
    const profile = await prisma.trainerProfile.create({
      data: {
        userId: user.id,
        businessName: SEED.owner.businessName,
        // A fully-onboarded owner has a phone — the (trainer) layout's
        // profile-completion gate redirects to /complete-profile without one,
        // which would bounce every authenticated spec off the dashboard.
        phone: '+6421000000',
        subscriptionStatus: 'ACTIVE',
        seatCount: 10, // room to invite the 5 trainers
        // Card payments live (no real Stripe call is made in these specs) and
        // the card fee passed on to the client — so the client-app invoice list
        // must quote balance + surcharge, exactly like the pay page does.
        acceptPaymentsEnabled: true,
        connectChargesEnabled: true,
        passProcessingFeeToClient: true,
      },
    })
    await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
    })
    // Marketing is an add-on — seed its BillingItem (FK target) then enable it
    // so the Marketing specs can reach the gated page.
    await prisma.billingItem.create({
      data: { id: 'marketing', kind: 'ADDON', name: 'Marketing', description: 'Bulk client email', priceMonthly: 10, sortOrder: 3, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'marketing', active: true },
    })
    // Timesheets add-on is free but off-by-default (no defaultOn) — the /timesheets
    // page redirects to add-ons without it, so enable it for the timesheets specs.
    await prisma.billingItem.create({
      data: { id: 'timesheets', kind: 'ADDON', name: 'Timesheets', description: 'Staff timesheets', priceMonthly: 0, sortOrder: 4, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'timesheets', active: true },
    })
    // Group classes is free + default-on (no TrainerAddon row = enabled), but
    // toggling it writes a TrainerAddon whose itemId is an FK to BillingItem —
    // without this row the toggle 500s on the constraint.
    await prisma.billingItem.create({
      data: { id: 'classes', kind: 'ADDON', name: 'Group classes', description: 'Class cohorts and enrolments', priceMonthly: 0, sortOrder: 5, isActive: true },
    })

    // An accepted MANAGER + STAFF member (with passwords) so permission specs
    // can sign in as them. Members have a membership, no TrainerProfile.
    const mgrHash = await bcrypt.hash(SEED.manager.password, 12)
    const mgrUser = await prisma.user.create({
      data: {
        email: SEED.manager.email, name: SEED.manager.name, role: 'TRAINER', emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: mgrHash } },
      },
    })
    await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: mgrUser.id, role: 'MANAGER', acceptedAt: new Date() },
    })
    const staffHash = await bcrypt.hash(SEED.staff.password, 12)
    const staffUser = await prisma.user.create({
      data: {
        email: SEED.staff.email, name: SEED.staff.name, role: 'TRAINER', emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: staffHash } },
      },
    })
    const staffMembership = await prisma.trainerMembership.create({
      data: { companyId: profile.id, userId: staffUser.id, role: 'STAFF', acceptedAt: new Date() },
    })

    // A platform ADMIN so admin-area specs (e.g. /admin/trainers) can sign in.
    // Role ADMIN — ignored by every trainer/company-scoped query.
    const adminHash = await bcrypt.hash(SEED.admin.password, 12)
    await prisma.user.create({
      data: {
        email: SEED.admin.email, name: SEED.admin.name, role: 'ADMIN', emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: adminHash } },
      },
    })

    // A sample client + dog + a package, so assigned-trainer flows have targets.
    // The client is assigned to the staff member so they can see it.
    // Password + phone so the CLIENT app can be logged into (my-invoices spec):
    // the (client) layout's intake gate demands a name + phone before it lets
    // anyone past, so a phone-less client would only ever see the gate.
    const clientHash = await bcrypt.hash(SEED.client.password, 12)
    const clientUser = await prisma.user.create({
      data: {
        email: SEED.client.email, name: SEED.client.name, role: 'CLIENT', emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: clientHash } },
      },
    })
    const dog = await prisma.dog.create({ data: { name: 'Bailey' } })
    await prisma.clientProfile.create({
      data: { id: SEED.assignedClientId, userId: clientUser.id, trainerId: profile.id, dogId: dog.id, status: 'ACTIVE', assignedMembershipId: staffMembership.id, phone: '+6421000009' },
    })
    // A second, unassigned client (fixed id) — staff should NOT see this one.
    const otherUser = await prisma.user.create({
      data: { email: 'other@e2e.test', name: 'Unassigned Client', role: 'CLIENT', emailVerified: new Date() },
    })
    await prisma.clientProfile.create({
      data: { id: SEED.unassignedClientId, userId: otherUser.id, trainerId: profile.id, status: 'ACTIVE' },
    })
    await prisma.package.create({
      data: { trainerId: profile.id, name: 'Puppy Foundations', sessionCount: 4, weeksBetween: 1 },
    })
    // A published public embed form, for the public-form rate-limit test.
    await prisma.embedForm.create({
      data: { id: SEED.embedFormId, trainerId: profile.id, title: 'Get in touch', isActive: true },
    })

    // ─── Business B: a SEPARATE tenant the pentest tries to breach ───────────
    const bHash = await bcrypt.hash(SEED.businessB.ownerPassword, 12)
    const bUser = await prisma.user.create({
      data: {
        email: SEED.businessB.ownerEmail, name: SEED.businessB.name, role: 'TRAINER', emailVerified: new Date(),
        accounts: { create: { type: 'credentials', provider: 'credentials', providerAccountId: bHash } },
      },
    })
    const bProfile = await prisma.trainerProfile.create({
      data: { userId: bUser.id, businessName: SEED.businessB.businessName, phone: '+6421000001', subscriptionStatus: 'ACTIVE' },
    })
    await prisma.trainerMembership.create({
      data: { companyId: bProfile.id, userId: bUser.id, role: 'OWNER', acceptedAt: new Date() },
    })
    const bClientUser = await prisma.user.create({
      data: { email: 'clientb@e2e.test', name: 'Rival Client', role: 'CLIENT', emailVerified: new Date() },
    })
    await prisma.clientProfile.create({
      data: { id: SEED.businessB.clientId, userId: bClientUser.id, trainerId: bProfile.id, status: 'ACTIVE' },
    })
    await prisma.package.create({
      data: { id: SEED.businessB.packageId, trainerId: bProfile.id, name: 'Rival Package', sessionCount: 4, weeksBetween: 1 },
    })

    // ─── Invoicing fixtures (see SEED.invoicing) ─────────────────────────────
    const INV = SEED.invoicing
    // A PRICED Business A package — assigning it (without "already invoiced")
    // raises a receivable via createInvoiceForAssignment.
    await prisma.package.create({
      data: { id: INV.pricedPackageId, trainerId: profile.id, name: 'Priced Puppy Course', sessionCount: 4, weeksBetween: 1, priceCents: 38000 },
    })
    // A PARTIAL invoice on the assigned client — $150 paid of $380.
    await prisma.invoice.create({
      data: {
        id: INV.partialInvoiceId, trainerId: profile.id, clientId: SEED.assignedClientId,
        amountCents: 38000, amountPaidCents: 15000, currency: 'nzd', status: 'PARTIAL',
        description: 'Half-Paid Course', sourceType: 'MANUAL', sentAt: new Date(),
        lines: { create: [{ description: 'Half-Paid Course', quantity: 1, unitAmountCents: 38000, amountCents: 38000, sortOrder: 0 }] },
      },
    })
    // An editable UNPAID invoice on the assigned client — one $200 line.
    await prisma.invoice.create({
      data: {
        id: INV.editableInvoiceId, trainerId: profile.id, clientId: SEED.assignedClientId,
        amountCents: 20000, amountPaidCents: 0, currency: 'nzd', status: 'UNPAID',
        // Fixed pay token so the client-app spec can assert the invoice links at
        // the right /pay/<token> (the same page the emailed link goes to).
        payToken: INV.editableInvoicePayToken,
        description: 'Editable Invoice', sourceType: 'MANUAL',
        lines: { create: [{ description: 'Consult', quantity: 1, unitAmountCents: 20000, amountCents: 20000, sortOrder: 0 }] },
      },
    })
    // A settled invoice on the assigned client — the client app's "Paid"
    // receipt list needs history to show. Nothing is owed on it, so it never
    // appears in an outstanding/receivable assertion.
    await prisma.invoice.create({
      data: {
        id: INV.paidInvoiceId, trainerId: profile.id, clientId: SEED.assignedClientId,
        amountCents: 12000, amountPaidCents: 12000, currency: 'nzd', status: 'PAID',
        description: 'Puppy Starter Pack', sourceType: 'MANUAL',
        sentAt: new Date('2026-05-02'), paidAt: new Date('2026-05-04'),
        lines: { create: [{ description: 'Starter pack', quantity: 1, unitAmountCents: 12000, amountCents: 12000, sortOrder: 0 }] },
      },
    })
    // A Business B invoice — the cross-tenant guard target.
    await prisma.invoice.create({
      data: {
        id: INV.businessBInvoiceId, trainerId: bProfile.id, clientId: SEED.businessB.clientId,
        amountCents: 5000, amountPaidCents: 0, currency: 'nzd', status: 'UNPAID',
        description: 'Rival Invoice', sourceType: 'MANUAL',
        lines: { create: [{ description: 'Rival Item', quantity: 1, unitAmountCents: 5000, amountCents: 5000, sortOrder: 0 }] },
      },
    })

    // A homework task on the assigned client, dated now so it shows in the
    // client home's "This week" list. The homework-log spec opens it and logs
    // a practice against it.
    await prisma.trainingTask.create({
      data: {
        id: SEED.homework.taskId,
        clientId: SEED.assignedClientId,
        dogId: dog.id,
        date: new Date(),
        title: SEED.homework.title,
        description: 'Practise loose-lead walking for 10 minutes on a quiet street.',
        repetitions: 3,
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    })

    console.log('[e2e] seed complete')
  } finally {
    await prisma.$disconnect()
  }
}
