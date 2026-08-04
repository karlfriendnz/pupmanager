/**
 * READ-ONLY. How much of audit C-3 / T-3 / T-4 is sitting in production right now.
 *
 * The code is fixed. This does not fix data that was already written — it counts
 * it, so the damage can be sized before anyone decides what to do about it.
 *
 * There is not a single write in this file. Every call is a count or a select.
 *
 *   npx dotenv -e .env.local -o -- npx tsx scripts/audit/withdrawn-unpaid-report.ts
 *
 * (.env.local carries the prod DATABASE_URL. Point it at .env.development.local
 * to rehearse against the local dev database first.)
 */
import { scriptPrisma } from '../../src/lib/prisma-script'

const money = (cents: number, ccy = 'nzd') =>
  `${ccy.toUpperCase()} ${(cents / 100).toFixed(2)}`

async function main() {
  const prisma = scriptPrisma()
  const host = (process.env.DATABASE_URL || process.env.DIRECT_URL || '').split('@')[1]?.split('/')[0]
  console.log(`\nReading (and only reading) ${host}\n`)

  // ── T-3 · withdrawn from the class, still being billed for it ──────────────
  // Enrolling raised the receivable; withdrawing never took it back off.
  const withdrawn = await prisma.classEnrollment.findMany({
    where: { status: 'WITHDRAWN' },
    select: { id: true, clientId: true, withdrawnAt: true },
  })
  const withdrawnIds = withdrawn.map(w => w.id)

  const stranded = withdrawnIds.length
    ? await prisma.invoice.findMany({
        where: {
          sourceType: 'CLASS_ENROLLMENT',
          sourceId: { in: withdrawnIds },
          status: { in: ['UNPAID', 'PARTIAL'] },
        },
        select: {
          id: true, amountCents: true, status: true, createdAt: true,
          trainer: { select: { businessName: true, payoutCurrency: true } },
          client: { select: { user: { select: { name: true, email: true } } } },
        },
      })
    : []

  console.log('── T-3 · withdrawn from a class, invoice still standing ─────────')
  console.log(`   withdrawn enrolments in total: ${withdrawn.length}`)
  console.log(`   of those, still carrying a live invoice: ${stranded.length}`)
  if (stranded.length) {
    const total = stranded.reduce((n, i) => n + i.amountCents, 0)
    console.log(`   total wrongly owed: ${money(total)} (mixed currencies — see the breakdown)`)
    const byTrainer = new Map<string, { n: number; cents: number; ccy: string }>()
    for (const i of stranded) {
      const key = i.trainer?.businessName ?? '(unknown)'
      const cur = byTrainer.get(key) ?? { n: 0, cents: 0, ccy: i.trainer?.payoutCurrency ?? 'nzd' }
      cur.n += 1; cur.cents += i.amountCents
      byTrainer.set(key, cur)
    }
    for (const [name, v] of [...byTrainer].sort((a, b) => b[1].cents - a[1].cents)) {
      console.log(`     ${String(v.n).padStart(3)} × ${money(v.cents, v.ccy).padEnd(16)} ${name}`)
    }
  }

  // ── C-3 · a cancelled shop order that left its invoice behind ──────────────
  // The cancel hard-deleted the ProductRequest row, so the footprint is a live
  // PRODUCT invoice with no request behind it. (The stock it never put back
  // cannot be recovered from the data — StockMovement has no matching return.)
  const productInvoices = await prisma.invoice.findMany({
    where: { sourceType: 'PRODUCT', status: { in: ['UNPAID', 'PARTIAL'] } },
    select: {
      id: true, amountCents: true, sourceId: true, clientId: true, createdAt: true,
      trainer: { select: { businessName: true, payoutCurrency: true } },
    },
  })
  let orphanProduct = 0
  let orphanCents = 0
  for (const inv of productInvoices) {
    if (!inv.sourceId) continue
    // productId only, deliberately. A varianted product invoices per VARIANT, so
    // matching on variantId would be more precise — but that column does not
    // exist in production yet (the product-variants migration is one of the 20
    // still unapplied), and a script that reads prod has to run against the
    // schema prod actually has. Matching on the product is the safe subset.
    const request = await prisma.productRequest.count({
      where: { clientId: inv.clientId, productId: inv.sourceId },
    })
    if (request === 0) { orphanProduct += 1; orphanCents += inv.amountCents }
  }
  console.log('\n── C-3 · cancelled shop order, invoice still standing ───────────')
  console.log(`   live PRODUCT invoices: ${productInvoices.length}`)
  console.log(`   of those, with no request behind them: ${orphanProduct}`)
  if (orphanProduct) console.log(`   total wrongly owed: ${money(orphanCents)}`)

  // ── T-4 · enrolled on a priced class and never billed ─────────────────────
  // A SUPERSET, deliberately. Nothing records that an enrolment was promoted off
  // a waitlist, so this cannot isolate the bug's victims. Plenty of these will be
  // legitimate — a membership covers the class, the trainer invoices off-platform,
  // the seat was comped. It is a list to eyeball, not a bill to send.
  const enrolled = await prisma.classEnrollment.findMany({
    where: { status: 'ENROLLED' },
    select: {
      id: true, clientId: true,
      classRun: {
        select: {
          name: true,
          trainer: { select: { businessName: true, payoutCurrency: true } },
          package: { select: { priceCents: true, specialPriceCents: true } },
        },
      },
    },
  })
  let unbilled = 0
  const unbilledByTrainer = new Map<string, number>()
  for (const e of enrolled) {
    const price = e.classRun?.package?.specialPriceCents ?? e.classRun?.package?.priceCents ?? 0
    if (!price || price <= 0) continue
    const invoiced = await prisma.invoice.count({
      where: { sourceType: 'CLASS_ENROLLMENT', sourceId: e.id },
    })
    if (invoiced === 0) {
      unbilled += 1
      const key = e.classRun?.trainer?.businessName ?? '(unknown)'
      unbilledByTrainer.set(key, (unbilledByTrainer.get(key) ?? 0) + 1)
    }
  }
  console.log('\n── T-4 · enrolled on a PRICED class with no invoice at all ──────')
  console.log(`   enrolled on a priced class: ${enrolled.length}`)
  console.log(`   of those, never invoiced: ${unbilled}   ← a superset, see the note`)
  for (const [name, n] of [...unbilledByTrainer].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`     ${String(n).padStart(3)}  ${name}`)
  }

  console.log('\nNothing was written.\n')
  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('FAILED', e)
  process.exit(1)
})
