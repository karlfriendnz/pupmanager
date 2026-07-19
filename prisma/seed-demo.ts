// Demo account seeder for App Store reviewers and live demos.
//
// Run with: `npm run db:seed-demo`        (prod / default DB)
//           `npm run db:seed-demo:dev`    (local pupmanager_dev)
//
// Idempotent: ensures the demo trainer exists, wipes their prior client-facing
// data, and rebuilds a fully-populated demo dataset (~50 clients, packages,
// sessions, library items, products, achievements, enquiries, etc.) via the
// shared engine in src/lib/demo-seed.ts.
//
// This CLI also layers on the team / business-ops demo data that the shared
// engine doesn't cover (it's CLI-only so the trainer-facing "load sample data"
// path never invents staff logins): team members + memberships, time rates,
// timesheets with entries, per-session time entries, client→trainer payments,
// and standing product requests. See seedTeamAndOps() below — it's separately
// idempotent (clears its own prior rows for the demo trainer, then rebuilds).

import { scriptPrisma } from "../src/lib/prisma-script"
import { ADDONS } from '../src/lib/pricing'
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  ensureDemoTrainer,
  seedDemoData,
} from '../src/lib/demo-seed'

const prisma = scriptPrisma()

// ─── Team members + business-ops demo data ────────────────────────────────────

// Staff who belong to the demo trainer's business. Stable emails (@pupmanager.team)
// key the upserts so re-runs find-or-update rather than duplicate. All share one
// password so a reviewer can sign in as any of them.
const TEAM_PASSWORD = 'trainer1234'
const TEAM_MEMBERS: Array<{
  name: string
  email: string
  role: 'MANAGER' | 'STAFF'
  title: string
  permissions: Record<string, boolean>
}> = [
  {
    name: 'Alex Rivers',
    email: 'alex.rivers@pupmanager.team',
    role: 'MANAGER',
    title: 'Senior trainer',
    // Manager preset is plenty; nudge a couple on for a richer demo.
    permissions: { 'clients.viewAll': true, 'schedule.viewAll': true, 'billing.view': true },
  },
  {
    name: 'Priya Shah',
    email: 'priya.shah@pupmanager.team',
    role: 'STAFF',
    title: 'Trainer',
    permissions: { 'clients.viewAll': true, 'schedule.viewAll': true },
  },
  {
    name: 'Tom Nguyen',
    email: 'tom.nguyen@pupmanager.team',
    role: 'STAFF',
    title: 'Trainer',
    permissions: {},
  },
  {
    name: 'Bella Owens',
    email: 'bella.owens@pupmanager.team',
    role: 'STAFF',
    title: 'Class assistant',
    permissions: { 'classes.manage': true },
  },
]

// Named hourly rates the business bills against. Keyed by (companyId, name).
const TIME_RATES: Array<{ name: string; rateCents: number; sortOrder: number }> = [
  { name: 'Training', rateCents: 8000, sortOrder: 0 },
  { name: 'Travel', rateCents: 4000, sortOrder: 1 },
  { name: 'Admin', rateCents: 5000, sortOrder: 2 },
]

const TIMESHEET_TASKS = [
  '1:1 session — loose-leash',
  'Reactive Rover group class',
  'Travel to client',
  'Session notes & homework write-up',
  'Puppy foundations class',
  'Phone consult — new enquiry',
  'Drop-in coaching',
  'Recall practice session',
]

// Monday of the ISO week `weeksAgo` weeks before `from` (date-only, UTC midnight).
function mondayOf(from: Date, weeksAgo: number): Date {
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  const dow = d.getUTCDay() // 0 Sun … 6 Sat
  const sinceMonday = (dow + 6) % 7
  d.setUTCDate(d.getUTCDate() - sinceMonday - weeksAgo * 7)
  return d
}

/**
 * Seed team members + business-ops data for the demo trainer. CLI-only.
 *
 * Idempotent: every block clears its own prior demo rows (scoped to this
 * trainer / the @pupmanager.team logins) before recreating, so re-runs neither
 * crash nor pile up duplicates. Runs AFTER seedDemoData so the clients,
 * sessions and products it references exist; payments / product requests point
 * at those fresh rows, so they're rebuilt every run (the older ones are cleared
 * first).
 */
async function seedTeamAndOps(trainerId: string) {
  const bcrypt = (await import('bcryptjs')).default
  const now = new Date()

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { userId: true },
  })
  const ownerUserId = trainer!.userId

  // ── Owner membership ────────────────────────────────────────────────────────
  // The demo trainer themselves should be the OWNER member of their own company.
  await prisma.trainerMembership.upsert({
    where: { companyId_userId: { companyId: trainerId, userId: ownerUserId } },
    create: {
      companyId: trainerId,
      userId: ownerUserId,
      role: 'OWNER',
      title: 'Owner',
      acceptedAt: now,
    },
    update: { role: 'OWNER', title: 'Owner', acceptedAt: now },
  })

  // ── Staff users + their memberships ──────────────────────────────────────────
  const memberships: Array<{ id: string; userId: string; name: string }> = []
  for (const m of TEAM_MEMBERS) {
    // Hash per-member: providerAccountId stores the hash and is globally unique
    // on (provider, providerAccountId), so each member needs a distinct salt.
    const hash = await bcrypt.hash(TEAM_PASSWORD, 12)
    const user = await prisma.user.upsert({
      where: { email: m.email },
      create: {
        name: m.name,
        email: m.email,
        role: 'TRAINER',
        emailVerified: new Date(),
        timezone: 'Pacific/Auckland',
      },
      update: { name: m.name, role: 'TRAINER' },
    })

    // Refresh the credentials account so the documented password always works.
    await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
    await prisma.account.create({
      data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
    })

    const membership = await prisma.trainerMembership.upsert({
      where: { companyId_userId: { companyId: trainerId, userId: user.id } },
      create: {
        companyId: trainerId,
        userId: user.id,
        role: m.role,
        title: m.title,
        permissions: m.permissions,
        // Most accepted; leave one outstanding to show the "invited" state.
        acceptedAt: m.name === 'Bella Owens' ? null : now,
      },
      update: {
        role: m.role,
        title: m.title,
        permissions: m.permissions,
        acceptedAt: m.name === 'Bella Owens' ? null : now,
      },
    })
    memberships.push({ id: membership.id, userId: user.id, name: m.name })
  }

  // ── Assign some clients + sessions to staff so "by trainer" views populate ───
  // Only touch this trainer's rows. Spread assignments round-robin across the
  // accepted staff memberships (skip the still-invited one).
  const activeMemberships = memberships.filter(m => m.name !== 'Bella Owens')
  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  for (let i = 0; i < clients.length; i++) {
    // Assign ~60% of clients to a staff member; leave the rest on the owner.
    if (i % 5 < 3) {
      const mem = activeMemberships[i % activeMemberships.length]
      await prisma.clientProfile.update({
        where: { id: clients[i].id },
        data: { assignedMembershipId: mem.id },
      })
    }
  }
  const sessions = await prisma.trainingSession.findMany({
    where: { trainerId },
    select: { id: true, durationMins: true, scheduledAt: true, status: true },
    orderBy: { scheduledAt: 'asc' },
  })
  for (let i = 0; i < sessions.length; i++) {
    const mem = activeMemberships[i % activeMemberships.length]
    await prisma.trainingSession.update({
      where: { id: sessions[i].id },
      data: { assignedMembershipId: mem.id },
    })
  }

  // ── Per-session time entries (billable hours logged against past sessions) ───
  // Clear prior entries for this trainer's sessions first (cascade-safe rebuild).
  await prisma.sessionTimeEntry.deleteMany({
    where: { session: { trainerId } },
  })
  const pastSessions = sessions.filter(s => s.scheduledAt.getTime() < now.getTime())
  const sessionTimeRows: Array<{
    sessionId: string
    membershipId: string
    minutes: number
    rateCents: number
    note: string | null
  }> = []
  for (let i = 0; i < pastSessions.length; i++) {
    // Log time on ~40% of past sessions, by their assigned (or round-robin) staff.
    if (i % 5 >= 2) continue
    const mem = activeMemberships[i % activeMemberships.length]
    sessionTimeRows.push({
      sessionId: pastSessions[i].id,
      membershipId: mem.id,
      minutes: pastSessions[i].durationMins || 60,
      rateCents: 8000,
      note: i % 3 === 0 ? 'Ran slightly over — extra recall reps.' : null,
    })
  }
  if (sessionTimeRows.length) {
    await prisma.sessionTimeEntry.createMany({ data: sessionTimeRows })
  }

  // ── Time rates (named hourly rates) ──────────────────────────────────────────
  const rateByName = new Map<string, { id: string; rateCents: number }>()
  for (const r of TIME_RATES) {
    const existing = await prisma.timeRate.findFirst({
      where: { companyId: trainerId, name: r.name },
      select: { id: true },
    })
    if (existing) {
      const updated = await prisma.timeRate.update({
        where: { id: existing.id },
        data: { rateCents: r.rateCents, sortOrder: r.sortOrder, archivedAt: null },
      })
      rateByName.set(r.name, { id: updated.id, rateCents: updated.rateCents })
    } else {
      const created = await prisma.timeRate.create({
        data: { companyId: trainerId, name: r.name, rateCents: r.rateCents, sortOrder: r.sortOrder },
      })
      rateByName.set(r.name, { id: created.id, rateCents: created.rateCents })
    }
  }

  // ── Timesheets + entries (a couple of weeks per member) ──────────────────────
  // Clear prior timesheets for this trainer (entries cascade), then rebuild so
  // line items always point at current TimeRate ids.
  await prisma.timesheet.deleteMany({ where: { companyId: trainerId } })

  // Owner + accepted staff each get 2 weekly timesheets (last 2 weeks).
  const sheetOwners: Array<{ userId: string; name: string }> = [
    { userId: ownerUserId, name: 'Demo Trainer' },
    ...activeMemberships.map(m => ({ userId: m.userId, name: m.name })),
  ]
  const clientIdsForLinking = clients.map(c => c.id)
  let timesheetCount = 0
  let timeEntryCount = 0
  // Deterministic-ish spread without pulling in the engine's RNG.
  let tick = 7
  const nextInt = (n: number) => {
    tick = (tick * 1103515245 + 12345) & 0x7fffffff
    return tick % n
  }
  for (const owner of sheetOwners) {
    for (let w = 1; w <= 2; w++) {
      const weekStart = mondayOf(now, w)
      const finalised = w === 2 // older week finalised, recent one a draft
      const sheet = await prisma.timesheet.create({
        data: {
          companyId: trainerId,
          userId: owner.userId,
          weekStart,
          title: `Week of ${weekStart.toISOString().slice(0, 10)}`,
          status: finalised ? 'FINALISED' : 'DRAFT',
          notes: finalised ? 'Submitted for payroll.' : null,
          finalisedAt: finalised ? new Date(weekStart.getTime() + 6 * 86400_000) : null,
        },
      })
      timesheetCount++
      const lineCount = 3 + nextInt(3) // 3–5 lines per sheet
      const entryRows: Array<{
        timesheetId: string
        date: Date
        task: string
        minutes: number
        rateId: string
        rateName: string
        rateCents: number
        amountCents: number
        clientId: string | null
        category: string | null
        sortOrder: number
      }> = []
      for (let l = 0; l < lineCount; l++) {
        const dayOffset = nextInt(5) // Mon–Fri
        const date = new Date(weekStart)
        date.setUTCDate(date.getUTCDate() + dayOffset)
        const rateName = TIME_RATES[nextInt(TIME_RATES.length)].name
        const rate = rateByName.get(rateName)!
        const minutes = (1 + nextInt(4)) * 30 // 30–120 min
        const amountCents = Math.round((minutes / 60) * rate.rateCents)
        const linkClient =
          clientIdsForLinking.length && nextInt(2) === 0
            ? clientIdsForLinking[nextInt(clientIdsForLinking.length)]
            : null
        entryRows.push({
          timesheetId: sheet.id,
          date,
          task: TIMESHEET_TASKS[nextInt(TIMESHEET_TASKS.length)],
          minutes,
          rateId: rate.id,
          rateName,
          rateCents: rate.rateCents,
          amountCents,
          clientId: linkClient,
          category: rateName,
          sortOrder: l,
        })
      }
      await prisma.timeEntry.createMany({ data: entryRows })
      timeEntryCount += entryRows.length
    }
  }

  // ── Client→trainer payments (earnings history) ───────────────────────────────
  // Rebuild every run: clear this trainer's prior payments (items/refunds
  // cascade), then create a spread of PAID purchases over recent weeks plus a
  // couple of other states so the earnings page reads alive.
  await prisma.payment.deleteMany({ where: { trainerId } })

  // Seed the earnings in the trainer's own base currency so the demo is
  // self-consistent when the currency isn't NZD (records keep the currency
  // they were transacted in — we just create them in the right one).
  const seedTrainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { payoutCurrency: true },
  })
  const demoCurrency = seedTrainer?.payoutCurrency ?? 'nzd'

  const paidPackages = await prisma.package.findMany({
    where: { trainerId },
    select: { id: true, name: true, priceCents: true },
  })
  const sellableProducts = await prisma.product.findMany({
    where: { trainerId, priceCents: { not: null } },
    select: { id: true, name: true, priceCents: true },
  })
  const payClients = clients.slice(0, Math.min(24, clients.length))
  let paymentCount = 0
  for (let i = 0; i < payClients.length; i++) {
    const client = payClients[i]
    const sellPackage = i % 2 === 0 && paidPackages.length > 0
    const status: 'PAID' | 'PENDING' | 'REFUNDED' =
      i % 11 === 0 ? 'REFUNDED' : i % 7 === 0 ? 'PENDING' : 'PAID'
    const daysAgo = (i % 28) + 1
    const created = new Date(now.getTime() - daysAgo * 86400_000)

    let item: {
      kind: 'PACKAGE' | 'PRODUCT'
      description: string
      unitAmount: number
      quantity: number
      productId: string | null
    }
    if (sellPackage) {
      const p = paidPackages[i % paidPackages.length]
      item = { kind: 'PACKAGE', description: p.name, unitAmount: p.priceCents ?? 30000, quantity: 1, productId: null }
    } else if (sellableProducts.length) {
      const p = sellableProducts[i % sellableProducts.length]
      item = { kind: 'PRODUCT', description: p.name, unitAmount: p.priceCents ?? 9000, quantity: 1, productId: p.id }
    } else {
      item = { kind: 'PRODUCT', description: 'Drop-in class', unitAmount: 9000, quantity: 1, productId: null }
    }
    const description = item.description
    const amount = item.unitAmount

    const applicationFee = Math.round(amount * 0.01)
    const cardFee = Math.round(amount * 0.029) + 30
    const refunded = status === 'REFUNDED' ? amount : 0
    await prisma.payment.create({
      data: {
        trainerId,
        clientId: client.id,
        connectAccountId: 'acct_demo_sandbox',
        amountTotal: amount,
        currency: demoCurrency,
        applicationFeeAmount: applicationFee,
        stripeFeeAmount: status === 'PAID' || status === 'REFUNDED' ? cardFee : null,
        amountRefunded: refunded,
        status,
        sandbox: true,
        description,
        paidAt: status === 'PENDING' ? null : created,
        createdAt: created,
        items: {
          create: [
            {
              kind: item.kind,
              description: item.description,
              unitAmount: item.unitAmount,
              quantity: item.quantity,
              productId: item.productId,
            },
          ],
        },
      },
    })
    paymentCount++
  }

  // ── Standing product requests (client wishlist → fulfil-at-session flow) ─────
  // ProductRequest.client / .product both cascade-delete, so seedDemoData's wipe
  // already cleared any prior ones; but clear explicitly to be safe on partial runs.
  await prisma.productRequest.deleteMany({ where: { client: { trainerId } } })
  let productRequestCount = 0
  if (sellableProducts.length) {
    const requestClients = clients.slice(0, Math.min(14, clients.length))
    const notes = [
      'Size L harness please',
      'For Bella — happy to pick up at our next session',
      null,
      'Could we grab two of these?',
      null,
    ]
    for (let i = 0; i < requestClients.length; i++) {
      const product = sellableProducts[i % sellableProducts.length]
      // Mostly PENDING (the live state the feature is built around); a few fulfilled.
      const fulfilled = i % 4 === 0
      await prisma.productRequest.create({
        data: {
          clientId: requestClients[i].id,
          productId: product.id,
          status: fulfilled ? 'FULFILLED' : 'PENDING',
          note: notes[i % notes.length],
          fulfilledAt: fulfilled ? new Date(now.getTime() - (i + 1) * 86400_000) : null,
        },
      })
      productRequestCount++
    }
  }

  return {
    teamMembers: TEAM_MEMBERS.length,
    timeRates: TIME_RATES.length,
    sessionTimeEntries: sessionTimeRows.length,
    timesheets: timesheetCount,
    timeEntries: timeEntryCount,
    payments: paymentCount,
    productRequests: productRequestCount,
  }
}

// ─── Add-ons ─────────────────────────────────────────────────────────────────
// Turn EVERY add-on on for the demo account so all gated features (Marketing,
// Route planner, Achievements, Shop, Timesheets) are visible and exercisable in
// the demo. Each add-on needs a BillingItem row (the FK target for TrainerAddon);
// we upsert those without touching any Stripe price columns already wired.
async function seedDemoAddons(trainerId: string) {
  let enabled = 0
  for (let i = 0; i < ADDONS.length; i++) {
    const a = ADDONS[i]
    await prisma.billingItem.upsert({
      where: { id: a.id },
      create: { id: a.id, kind: 'ADDON', name: a.name, description: a.description, priceMonthly: a.price.NZD, sortOrder: 10 + i, isActive: true },
      update: {}, // never overwrite live/test Stripe price columns
    })
    // Enable every real (non-coming-soon) add-on. AI stays coming-soon.
    if (!a.comingSoon) {
      await prisma.trainerAddon.upsert({
        where: { trainerId_itemId: { trainerId, itemId: a.id } },
        create: { trainerId, itemId: a.id, active: true },
        update: { active: true },
      })
      enabled++
    }
  }
  return enabled
}

// ─── Waitlist + client notifications ─────────────────────────────────────────
// Two features that had no demo data — a waitlist (the Clients → Waitlist tab)
// and a log of notifications sent to clients.
async function seedEngagement(trainerId: string) {
  const [clients, packages] = await Promise.all([
    prisma.clientProfile.findMany({ where: { trainerId }, select: { id: true }, take: 20 }),
    prisma.package.findMany({ where: { trainerId }, select: { id: true }, take: 4 }),
  ])

  await prisma.waitlistEntry.deleteMany({ where: { trainerId } })
  const waiting = [
    ['Harriet Cole', 'harriet.cole@example.com'],
    ['Devon Pike', 'devon.pike@example.com'],
    ['Mara Quinn', 'mara.quinn@example.com'],
    ['Ollie Birch', 'ollie.birch@example.com'],
    ['Sienna Frost', 'sienna.frost@example.com'],
  ]
  for (let i = 0; i < waiting.length; i++) {
    await prisma.waitlistEntry.create({
      data: {
        trainerId, name: waiting[i][0], email: waiting[i][1],
        packageId: packages.length ? packages[i % packages.length].id : null,
        status: 'WAITING', priority: i, request: 'Keen for the next intake — flexible on days.',
      },
    })
  }

  await prisma.clientNotification.deleteMany({ where: { trainerId } })
  const subjects = ['Session reminder', 'New training plan ready', 'Your session recap is up', 'Class spot confirmed', 'Payment receipt']
  const notifyClients = clients.slice(0, Math.min(12, clients.length))
  for (let i = 0; i < notifyClients.length; i++) {
    await prisma.clientNotification.create({
      data: {
        clientId: notifyClients[i].id, trainerId,
        subject: subjects[i % subjects.length], notes: 'Open the app to see the details.',
        sentAt: new Date(Date.now() - i * 86_400_000),
      },
    })
  }
  return { waitlist: waiting.length, notifications: notifyClients.length }
}

// ─── Entrypoint ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding demo trainer: ${DEMO_EMAIL}`)
  const trainerId = await ensureDemoTrainer(prisma)
  const result = await seedDemoData(prisma, trainerId)
  const ops = await seedTeamAndOps(trainerId)
  const addonsEnabled = await seedDemoAddons(trainerId)
  console.log(`  Add-ons enabled:   ${addonsEnabled}`)
  const engagement = await seedEngagement(trainerId)
  console.log(`  Waitlist:          ${engagement.waitlist}`)
  console.log(`  Notifications:     ${engagement.notifications}`)

  console.log(`✓ Demo trainer ready`)
  console.log(`  Email:    ${DEMO_EMAIL}`)
  console.log(`  Password: ${DEMO_PASSWORD}`)
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k.padEnd(18)} ${v}`)
  }
  console.log(`  Team + ops:`)
  for (const [k, v] of Object.entries(ops)) {
    console.log(`    ${k.padEnd(18)} ${v}`)
  }
  console.log(`  Team logins (password "${TEAM_PASSWORD}"):`)
  for (const m of TEAM_MEMBERS) {
    console.log(`    ${m.email.padEnd(32)} ${m.role} — ${m.title}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
