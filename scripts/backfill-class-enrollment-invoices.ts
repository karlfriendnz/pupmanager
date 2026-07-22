/**
 * Raise the missing receivables for class enrolments.
 *
 * Class enrolment was the one priced thing that never called
 * createInvoiceForAssignment, so every enrolment ever made has no invoice
 * behind it while 1:1 packages and products do. This backfills them.
 *
 * Safe by construction:
 *  - DRY RUN by default; --apply writes.
 *  - REAL trainers only: internal/demo businesses and sample (first-run
 *    preview) clients are skipped — unless --trainer=<id> names one explicitly,
 *    or --include-internal is passed. Some "internal" accounts run real classes
 *    for real clients, so the blanket skip can hide genuine gaps.
 *  - Never emails. Invoices are created with sentAt = null, so they appear as
 *    unsent receivables the trainer can review and send themselves. Blasting
 *    "pay now" at people for a class they attended months ago would be worse
 *    than the missing invoice.
 *  - Skips enrolments that are withdrawn, unpriced, or already invoiced
 *    (invoicedAt set, or an invoice row already points at them).
 *  - Skips classes whose last session has already been, unless --include-past.
 *    Historical enrolments were very often settled outside PupManager (cash, a
 *    prior system, an import), so billing them retrospectively is opt-in.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-class-enrollment-invoices.ts
 *   … --apply                    write them
 *   … --include-past             also invoice finished classes
 *   … --trainer=<trainerId>      limit to one business
 */
import { prisma } from '../src/lib/prisma'
import { dropInPriceCents } from '../src/lib/class-runs'

const APPLY = process.argv.includes('--apply')
const INCLUDE_PAST = process.argv.includes('--include-past')
const ONLY_TRAINER = process.argv.find(a => a.startsWith('--trainer='))?.split('=')[1] ?? null
const INCLUDE_INTERNAL = process.argv.includes('--include-internal')

async function main() {
  console.log(`\nClass-enrolment invoice backfill ${APPLY ? '— *** APPLYING ***' : '(dry run)'}`)
  console.log(`  past classes: ${INCLUDE_PAST ? 'INCLUDED' : 'skipped'}${ONLY_TRAINER ? ` · trainer: ${ONLY_TRAINER}` : ''}\n`)

  const enrolments = await prisma.classEnrollment.findMany({
    where: {
      status: { in: ['ENROLLED'] },
      invoicedAt: null,
      classRun: {
        ...(ONLY_TRAINER ? { trainerId: ONLY_TRAINER } : {}),
        // Real businesses only — UNLESS a trainer was named explicitly. The
        // isInternal flag means "ours", but some of those accounts (Paws And
        // Thrive) run genuine classes for genuine clients, so a blanket skip
        // silently missed them. Naming the business is the operator saying
        // they know what it is.
        ...(ONLY_TRAINER || INCLUDE_INTERNAL ? {} : { trainer: { isInternal: false } }),
      },
      // Never bill a first-run preview client.
      client: { isSample: false },
    },
    select: {
      id: true, type: true, joinedAtIndex: true, clientId: true,
      client: { select: { user: { select: { name: true } } } },
      classRun: {
        select: {
          id: true, name: true, trainerId: true,
          trainer: { select: { businessName: true, payoutCurrency: true } },
          package: { select: { priceCents: true, specialPriceCents: true, dropInPriceCents: true, sessionCount: true } },
          sessions: { orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
        },
      },
    },
  })

  const now = Date.now()
  const byTrainer = new Map<string, { name: string; count: number; cents: number }>()
  let created = 0, skippedPast = 0, skippedUnpriced = 0, skippedExisting = 0

  for (const e of enrolments) {
    const run = e.classRun
    const pkg = run.package

    const amountCents = e.type === 'DROP_IN'
      ? dropInPriceCents({ dropInPriceCents: pkg.dropInPriceCents, sessionCount: pkg.sessionCount, joinedAtIndex: e.joinedAtIndex ?? 1 })
      : (pkg.specialPriceCents ?? pkg.priceCents)
    if (!amountCents || amountCents <= 0) { skippedUnpriced++; continue }

    const lastSession = run.sessions[0]?.scheduledAt
    if (!INCLUDE_PAST && lastSession && lastSession.getTime() < now) { skippedPast++; continue }

    // Same idempotency key createInvoiceForAssignment uses.
    const already = await prisma.invoice.count({
      where: { trainerId: run.trainerId, clientId: e.clientId, sourceType: 'CLASS_ENROLLMENT', sourceId: e.id },
    })
    if (already > 0) { skippedExisting++; continue }

    const key = run.trainerId
    const agg = byTrainer.get(key) ?? { name: run.trainer.businessName, count: 0, cents: 0 }
    agg.count++; agg.cents += amountCents
    byTrainer.set(key, agg)

    if (APPLY) {
      await prisma.invoice.create({
        data: {
          trainerId: run.trainerId,
          clientId: e.clientId,
          amountCents,
          currency: run.trainer.payoutCurrency ?? 'nzd',
          status: 'UNPAID',
          description: run.name,
          sourceType: 'CLASS_ENROLLMENT',
          sourceId: e.id,
          // Unsent on purpose — the trainer decides who actually gets chased.
          sentAt: null,
          lines: { create: [{ description: run.name, quantity: 1, unitAmountCents: amountCents, amountCents, sortOrder: 0 }] },
        },
      })
    }
    created++
  }

  console.log(`${APPLY ? 'Created' : 'Would create'} ${created} invoice(s):\n`)
  for (const [id, v] of byTrainer) {
    console.log(`  ${v.name.padEnd(38)} ${String(v.count).padStart(4)} invoices · ${(v.cents / 100).toFixed(2)}  [${id}]`)
  }
  console.log(`\n  skipped — already invoiced: ${skippedExisting} · unpriced: ${skippedUnpriced} · past classes: ${skippedPast}`)
  if (!APPLY && created > 0) console.log('\n  Re-run with --apply to write these.\n')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
