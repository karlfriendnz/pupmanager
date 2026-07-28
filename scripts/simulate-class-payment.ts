/**
 * Simulate a client paying by card for a class place — LOCAL DEV ONLY.
 *
 * Stripe Checkout can't complete against localhost (no connected account, and
 * no webhook delivery), so there is no way to reach the paid-enrolment path by
 * clicking. This writes the same rows Checkout would and then calls the SAME
 * fulfilment code the connect webhook calls — enrollInRun, then
 * settleClassEnrolmentPayment — so what you're testing is the real thing, not a
 * reimplementation of it.
 *
 * What it does NOT cover: Stripe itself, the webhook signature check, and the
 * charge-verification guard in markPaidAndFulfil. Everything after "the payment
 * is real" is exercised for you.
 *
 * Run:
 *   dotenv -e .env.development.local -- tsx scripts/simulate-class-payment.ts
 *   dotenv -e .env.development.local -- tsx scripts/simulate-class-payment.ts --run <runId> --client <clientProfileId>
 *
 * With no arguments it lists the priced classes it can act on and stops.
 */
import { scriptPrisma } from '../src/lib/prisma-script'
import { enrollInRun, wholeRunPriceCents } from '../src/lib/class-runs'
import { settleClassEnrolmentPayment } from '../src/lib/invoicing'

const prisma = scriptPrisma()

// Hard stop before anything is written: this fabricates PAID payment rows, and
// doing that to the production ledger would be a fiction nobody could untangle.
function assertLocal() {
  const url = process.env.DATABASE_URL ?? ''
  const local = url.includes('localhost') || url.includes('127.0.0.1')
  if (!local) {
    console.error('\nREFUSING TO RUN — DATABASE_URL is not a local database.')
    console.error('This writes PAID payment rows. Never against production.')
    console.error(`Saw: ${url.replace(/:[^:@]+@/, ':***@') || '(empty)'}\n`)
    process.exit(1)
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  assertLocal()

  const runId = arg('run')
  const clientId = arg('client')

  if (!runId) {
    const runs = await prisma.classRun.findMany({
      where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
      select: {
        id: true, name: true,
        trainer: { select: { businessName: true } },
        package: { select: { priceCents: true, dropInPriceCents: true, allowDropIn: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: { startDate: 'desc' },
      take: 25,
    })
    console.log('\nClasses you can simulate a payment on:\n')
    for (const r of runs) {
      const price = r.package.allowDropIn
        ? await wholeRunPriceCents(r.id, r.package)
        : r.package.priceCents
      console.log(`  ${r.id}`)
      console.log(`    ${r.name} — ${r.trainer.businessName}`)
      console.log(`    ${r._count.sessions} sessions · full run ${price == null ? '(no price)' : '$' + (price / 100).toFixed(2)}\n`)
    }
    console.log('Then run again with:  --run <runId> [--client <clientProfileId>]\n')
    return
  }

  const run = await prisma.classRun.findUnique({
    where: { id: runId },
    select: {
      id: true, name: true, trainerId: true,
      package: { select: { priceCents: true, specialPriceCents: true, dropInPriceCents: true, allowDropIn: true } },
    },
  })
  if (!run) throw new Error(`No class run ${runId}`)

  // Same price the checkout would have charged, from the same helper.
  const amount = run.package.allowDropIn
    ? (await wholeRunPriceCents(run.id, run.package)) ?? run.package.specialPriceCents ?? run.package.priceCents
    : run.package.specialPriceCents ?? run.package.priceCents ?? await wholeRunPriceCents(run.id, run.package)
  if (!amount || amount <= 0) {
    throw new Error('That class has no price, so there is nothing to pay and nothing to test.')
  }

  const client = clientId
    ? await prisma.clientProfile.findFirst({
        where: { id: clientId, trainerId: run.trainerId },
        select: { id: true, dogId: true, user: { select: { name: true } } },
      })
    : await prisma.clientProfile.findFirst({
        where: {
          trainerId: run.trainerId,
          status: 'ACTIVE',
          classEnrollments: { none: { classRunId: run.id, status: { not: 'WITHDRAWN' } } },
        },
        select: { id: true, dogId: true, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
  if (!client) throw new Error('No client of that trainer is free to enrol on this class.')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: run.trainerId },
    select: { payoutCurrency: true, connectAccountId: true },
  })

  // ── The rows Checkout would have left behind ──────────────────────────────
  const payment = await prisma.payment.create({
    data: {
      trainerId: run.trainerId,
      clientId: client.id,
      amountTotal: amount,
      currency: trainer?.payoutCurrency ?? 'nzd',
      // No platform cut on a simulated charge — nothing left Stripe.
      applicationFeeAmount: 0,
      status: 'PAID',
      paidAt: new Date(),
      sandbox: true,
      description: `${run.name} (full)`,
      stripePaymentIntentId: `pi_simulated_${Date.now()}`,
      connectAccountId: trainer?.connectAccountId ?? 'acct_simulated_local',
    },
  })
  const item = await prisma.paymentItem.create({
    data: {
      paymentId: payment.id,
      kind: 'CLASS_ENROLLMENT',
      description: run.name,
      unitAmount: amount,
      quantity: 1,
      intent: { classRunId: run.id, type: 'FULL', dogId: client.dogId ?? null, sessionId: null },
    },
  })

  // ── From here on it is the webhook's own code, not a copy of it ───────────
  const enrolment = await enrollInRun({
    classRunId: run.id,
    clientId: client.id,
    dogId: client.dogId ?? null,
    type: 'FULL',
    sessionId: null,
    source: 'SELF_SERVE',
  })
  await prisma.paymentItem.update({
    where: { id: item.id },
    data: { classEnrollmentId: enrolment.enrollmentId },
  })
  await prisma.classEnrollment.update({
    where: { id: enrolment.enrollmentId },
    data: { invoicedAt: new Date() },
  })
  const invoiceId = await settleClassEnrolmentPayment({
    trainerId: run.trainerId,
    clientId: client.id,
    enrollmentId: enrolment.enrollmentId,
    paymentItemId: item.id,
    paymentId: payment.id,
  })

  const invoice = invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, amountCents: true, amountPaidCents: true },
      })
    : null

  console.log('\n✅ Simulated a paid enrolment\n')
  console.log(`  class    : ${run.name}`)
  console.log(`  client   : ${client.user.name ?? client.id}`)
  console.log(`  charged  : $${(amount / 100).toFixed(2)}`)
  console.log(`  seat     : ${enrolment.status}`)
  console.log(`  invoice  : ${invoice ? `${invoice.status} — paid $${(invoice.amountPaidCents / 100).toFixed(2)} of $${(invoice.amountCents / 100).toFixed(2)}` : 'NONE (this is the bug)'}`)
  console.log(`\n  Now open  http://localhost:7777/classes/${run.id}  → Clients tab.`)
  console.log('  It should say Paid, not "No invoice".\n')
}

main()
  .catch(e => { console.error('\n' + (e instanceof Error ? e.message : String(e)) + '\n'); process.exit(1) })
  .finally(() => prisma.$disconnect())
