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
import { dateOnlyUtc, todayInTz } from '../../src/lib/timezone'

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
    // The rest of the PAID catalogue as BillingItem rows. In production every
    // add-on has one, and `available` on the Add-ons tab is exactly
    // "is there a sellable BillingItem for this id" — so without these the
    // trainer-journey spec meets a permanently disabled "Turn on" button that
    // no real trainer would ever see. Seeded, not enabled: switching them on is
    // what that journey is there to walk.
    for (const [id, name, price] of [
      ['routeplanner', 'Route planner', 10],
      ['leadmagnets', 'Lead magnets', 10],
    ] as const) {
      await prisma.billingItem.upsert({
        where: { id },
        update: { isActive: true },
        create: { id, kind: 'ADDON', name, description: name, priceMonthly: price, sortOrder: 20, isActive: true },
      })
    }

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
    // To-do & brain dump is free but off-by-default. With it off the To do
    // screen has only its Notes tab, so the tabs spec needs it on — and the
    // dashboard's right rail then carries the same scratchpad, which is how a
    // real trainer with the add-on sees it.
    await prisma.billingItem.create({
      data: { id: 'todos', kind: 'ADDON', name: 'To-do & brain dump', description: 'Scratchpad for to-dos and notes', priceMonthly: 0, sortOrder: 10, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'todos', active: true },
    })
    // Achievements is a PAID add-on, so unlike the free ones above it cannot be
    // switched on through /api/addons from a trial account — the achievement
    // specs were hitting the add-on gate and being redirected to the Add-ons
    // tab. That made the cross-tenant test read a 200 and look like a tenancy
    // leak, when the tenancy query was never reached at all. Seeded as an
    // admin-granted comp, which is the real mechanism for free access.
    await prisma.billingItem.create({
      data: { id: 'achievements', kind: 'ADDON', name: 'Client achievements', description: 'Branded badges clients earn', priceMonthly: 19, sortOrder: 11, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'achievements', active: true, grantedByAdmin: true },
    })
    // Client shop — same story as achievements: PAID, so it can't be toggled on
    // from a trial account, and the product specs (editor page, purchases tab,
    // sale price, stock) all hit the add-on gate and read the redirect instead
    // of the page. Including the "another trainer's product is a 404" test,
    // which was failing for the gate rather than for tenancy.
    await prisma.billingItem.create({
      data: { id: 'shop', kind: 'ADDON', name: 'Client shop', description: 'In-app checkout for extras', priceMonthly: 29, sortOrder: 12, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'shop', active: true, grantedByAdmin: true },
    })
    // Group classes is free + default-on (no TrainerAddon row = enabled), but
    // toggling it writes a TrainerAddon whose itemId is an FK to BillingItem —
    // without this row the toggle 500s on the constraint.
    await prisma.billingItem.create({
      data: { id: 'classes', kind: 'ADDON', name: 'Group classes', description: 'Class cohorts and enrolments', priceMonthly: 0, sortOrder: 5, isActive: true },
    })
    // Events is free but off-by-default — /events redirects to the Add-ons tab
    // without it, so enable it for the events specs (same shape as timesheets).
    await prisma.billingItem.create({
      data: { id: 'events', kind: 'ADDON', name: 'Events', description: 'One-off events with tickets', priceMonthly: 0, sortOrder: 6, isActive: true },
    })
    await prisma.trainerAddon.create({
      data: { trainerId: profile.id, itemId: 'events', active: true },
    })
    // Casual classes + doggy daycare are the same story — each section's routes
    // redirect to the Add-ons tab when its add-on is off, so the specs that open
    // /casual-classes/<run> and /doggy-daycare/<run> need them on.
    for (const [id, name, description, sortOrder] of [
      ['dropins', 'Casual classes', 'Single-session casual classes', 7],
      ['puppyschool', 'Doggy daycare', 'Day-parted daycare with a week board', 8],
      ['memberships', 'Packages', 'Bundle offerings into one purchase', 9],
    ] as const) {
      await prisma.billingItem.create({
        data: { id, kind: 'ADDON', name, description, priceMonthly: 0, sortOrder, isActive: true },
      })
      await prisma.trainerAddon.create({ data: { trainerId: profile.id, itemId: id, active: true } })
    }

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
    // A FREE, instant, client-self-bookable package + week-round availability, so
    // the /my-availability booking wizard has something to offer on any day.
    await prisma.package.create({
      data: {
        id: SEED.selfBookPackageId, trainerId: profile.id, name: 'Self-Book Session',
        sessionCount: 1, weeksBetween: 1, durationMins: 60, clientSelfBook: true,
        selfBookRequiresApproval: false,
      },
    })
    await prisma.availabilitySlot.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({
        trainerId: profile.id, dayOfWeek, startTime: '09:00', endTime: '17:00', cadenceWeeks: 1,
      })),
    })
    // A published public embed form, for the public-form rate-limit test.
    await prisma.embedForm.create({
      data: { id: SEED.embedFormId, trainerId: profile.id, title: 'Get in touch', isActive: true },
    })
    // One NEW enquiry with a known id, so the enquiries spec can tap a row and
    // assert exactly where it lands. (The rate-limit spec also creates
    // enquiries, but its count varies — this one is deterministic.)
    await prisma.enquiry.create({
      data: {
        id: SEED.enquiryId, trainerId: profile.id, formId: SEED.embedFormId,
        name: SEED.enquiryName, email: 'tap-me@e2e.test', phone: '+64 21 000 111',
        dogName: 'Pixel', dogBreed: 'Border Collie',
        message: 'Our pup pulls on the lead — can you help?',
        status: 'NEW',
      },
    })
    // A PENDING booking request proposing 4 sessions, so /schedule?previewRequest=
    // renders the approve/decline preview card.
    {
      const base = new Date()
      base.setUTCHours(10, 0, 0, 0)
      const dates = [7, 14, 21, 28].map(d => new Date(base.getTime() + d * 86_400_000).toISOString())
      await prisma.bookingRequest.create({
        data: {
          id: SEED.previewRequestId,
          trainerId: profile.id,
          clientId: SEED.assignedClientId,
          packageId: SEED.selfBookPackageId,
          sessionDates: dates,
          status: 'PENDING',
        },
      })
    }
    // A published one-off membership bundling the self-book package, so the
    // client Offerings flow has a "Memberships" type to drill into. Buying it
    // needs Stripe, so specs stop at the card (the buy route has unit coverage).
    await prisma.membership.create({
      data: {
        id: SEED.membershipId, trainerId: profile.id, name: SEED.membershipName,
        description: 'Everything a new pup needs.', priceCents: 12000, published: true,
        items: { create: [{ kind: 'PACKAGE', packageId: SEED.selfBookPackageId, quantity: 2, order: 0 }] },
      },
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
      // A public slug, because Business B is the one whose JOIN LINK the
      // self-signup spec walks a dog owner through — /c/<slug>/join is the only
      // way in, so without it there is no door to knock on.
      data: { userId: bUser.id, businessName: SEED.businessB.businessName, slug: SEED.businessB.slug, phone: '+6421000001', subscriptionStatus: 'ACTIVE' },
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
        lines: { create: [{ description: '1:1 Session', quantity: 1, unitAmountCents: 20000, amountCents: 20000, sortOrder: 0 }] },
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
    // A long-titled, four-figure, Xero-SYNCED invoice on the assigned client.
    // It exists so the invoice list holds rows of differing title length, money
    // width, badge width AND both synced/unsynced states at once — which is what
    // the right-hand column alignment has to survive.
    await prisma.invoice.create({
      data: {
        id: INV.longTitleInvoiceId, trainerId: profile.id, clientId: SEED.assignedClientId,
        amountCents: 124000, amountPaidCents: 0, currency: 'nzd', status: 'UNPAID',
        description: INV.longTitleInvoiceDescription, sourceType: 'MANUAL', sentAt: new Date(),
        xeroInvoiceId: INV.longTitleInvoiceXeroId, xeroSyncStatus: 'SYNCED',
        lines: { create: [{ description: INV.longTitleInvoiceDescription, quantity: 1, unitAmountCents: 124000, amountCents: 124000, sortOrder: 0 }] },
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

    // ─── Transaction fixtures (see SEED.payments) ────────────────────────────
    // Settled card payments on Business A's assigned client. They give the
    // Transactions tab real rows with a real card fee, so the list-row layout
    // (and the fee/net figures living in the DETAIL, not the row) is testable.
    const PAY = SEED.payments
    await prisma.payment.create({
      data: {
        id: PAY.plainId, trainerId: profile.id, clientId: SEED.assignedClientId,
        connectAccountId: 'acct_e2e_test', amountTotal: PAY.plainAmount, currency: 'nzd',
        applicationFeeAmount: 0, stripeFeeAmount: PAY.plainFee, amountRefunded: 0,
        status: 'PAID', description: PAY.plainDescription, paidAt: new Date('2026-07-15'),
      },
    })
    await prisma.payment.create({
      data: {
        id: PAY.refundedId, trainerId: profile.id, clientId: SEED.assignedClientId,
        connectAccountId: 'acct_e2e_test', amountTotal: PAY.refundedAmount, currency: 'nzd',
        applicationFeeAmount: 0, stripeFeeAmount: PAY.refundedFee, amountRefunded: 5000,
        status: 'PARTIALLY_REFUNDED', description: PAY.refundedDescription, paidAt: new Date('2026-07-10'),
      },
    })

    // ─── Training Library fixtures (see SEED.library) ────────────────────────
    // Business A gets a category with two themes and one item; Business B gets
    // its own item so the cross-tenant guard has a real target. The item's
    // description is rich text on purpose — the item page renders it through
    // <RichText/> and the theme list flattens it to a plain preview.
    const LIB = SEED.library
    await prisma.libraryType.create({
      data: { id: LIB.typeId, trainerId: profile.id, name: LIB.typeName, order: 0 },
    })
    await prisma.libraryTheme.create({
      data: { id: LIB.themeId, typeId: LIB.typeId, name: LIB.themeName, order: 0 },
    })
    await prisma.libraryTheme.create({
      data: { id: LIB.themeTwoId, typeId: LIB.typeId, name: LIB.themeTwoName, order: 1 },
    })
    await prisma.libraryTask.create({
      data: {
        id: LIB.itemId, typeId: LIB.typeId, themeId: LIB.themeId, title: LIB.itemTitle,
        description: '<p>Ask for a <strong>sit</strong>, then step back.</p>',
        repetitions: 5, order: 0,
      },
    })
    await prisma.libraryType.create({
      data: { id: 'e2eblibtype00000000000000', trainerId: bProfile.id, name: 'Rival Library', order: 0 },
    })
    await prisma.libraryTheme.create({
      data: { id: LIB.businessBThemeId, typeId: 'e2eblibtype00000000000000', name: 'Rival Theme', order: 0 },
    })
    await prisma.libraryTask.create({
      data: { id: LIB.businessBItemId, typeId: 'e2eblibtype00000000000000', themeId: LIB.businessBThemeId, title: 'Rival Item', order: 0 },
    })

    // A homework task on the assigned client, dated today so it shows in the
    // client home's "This week" list. The homework-log spec opens it and logs
    // a practice against it.
    //
    // "Today" means today in the TRAINER's timezone (User.timezone defaults to
    // Pacific/Auckland), because that's the week the client home renders and
    // it's what a trainer's own date picker would have sent. `new Date()` here
    // stored the UTC calendar day instead, which on a NZ Monday morning is
    // last week — the seeded homework then fell outside the window whatever
    // zone the test host ran in.
    await prisma.trainingTask.create({
      data: {
        id: SEED.homework.taskId,
        clientId: SEED.assignedClientId,
        dogId: dog.id,
        date: dateOnlyUtc(todayInTz('Pacific/Auckland')),
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
