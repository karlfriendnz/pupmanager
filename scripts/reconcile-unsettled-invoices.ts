/**
 * Find (and optionally repair) invoices the client PAID but that were never
 * marked paid.
 *
 * WHY THESE EXIST
 * `invoices.paymentId` was UNIQUE until 2026-07-30. A client booking four
 * drop-in dates pays ONCE and gets one invoice per date, so the first invoice
 * claimed the payment and every later settlement failed the constraint —
 * swallowed by the catch in settleInvoiceFromPayment. The result: money in the
 * bank, invoices 2..N sitting on "Sent" forever, and a trainer ticking them off
 * by hand. The schema fix stops it happening again; it cannot repair history,
 * which is what this is for.
 *
 * HOW A STRANDED INVOICE IS FOUND
 * `paymentId` is exactly the link that was never written, so it can't be the
 * way in. The route back is the fulfilment chain, which DID get written:
 *
 *   Payment (PAID) -> PaymentItem.classEnrollmentId -> ClassEnrollment
 *                                                   -> Invoice.sourceId
 *
 * Each PaymentItem carries what that line cost (unitAmount x quantity), which
 * is the amount that should have settled its invoice — never the payment total,
 * or one card payment covering four dates would be counted four times.
 *
 * WHAT IT REFUSES TO TOUCH
 * Anything it cannot account for exactly is reported and skipped, never
 * guessed at:
 *   - an invoice funded by more than one distinct payment
 *   - a paid enrolment with no invoice at all (a different bug, not this one)
 *   - an invoice whose funding lines don't cover its total (part-payments)
 *   - CANCELLED invoices that were not merged into another
 *
 * An invoice folded into a combined one (mergedIntoId) is reported as already
 * settled, not as outstanding — that is how a trainer has been clearing these
 * by hand, and chasing settled money is how a reconciliation tool stops being
 * trusted.
 * A money script that guesses is worse than one that leaves work for a human.
 *
 * USAGE
 *   # look, change nothing (default)
 *   dotenv -e .env.development.local -o -- tsx scripts/reconcile-unsettled-invoices.ts
 *
 *   # against production, still read-only
 *   DATABASE_URL="postgres://..." tsx scripts/reconcile-unsettled-invoices.ts
 *
 *   # actually write
 *   DATABASE_URL="postgres://..." tsx scripts/reconcile-unsettled-invoices.ts --apply
 *
 *   --trainer <id>   limit to one trainer
 *   --json           machine-readable output
 *
 * NOTE it must be able to run against production — that is where the stranded
 * invoices are — so it has no local-only guard. Its safety is that writing
 * requires --apply, and it prints the database it is pointed at first.
 */
import { scriptPrisma } from '../src/lib/prisma-script'
import { applyPaidAmount } from '../src/lib/invoicing'

const prisma = scriptPrisma()

const APPLY = process.argv.includes('--apply')
const JSON_OUT = process.argv.includes('--json')
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const TRAINER = arg('trainer')

function money(cents: number, currency: string): string {
  const sym = currency.toLowerCase() === 'gbp' ? '£' : currency.toLowerCase() === 'usd' ? '$' : ''
  return `${sym}${(cents / 100).toFixed(2)}${sym ? '' : ` ${currency.toUpperCase()}`}`
}

/** Redact the credentials before printing a connection string. */
function safeUrl(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@').replace(/\?.*$/, '')
}

type Candidate = {
  invoiceId: string
  client: string
  description: string
  currency: string
  amountCents: number
  amountPaidCents: number
  status: string
  fundedCents: number
  paymentIds: string[]
  nextStatus: string
  nextPaidCents: number
}

type Skipped = { invoiceId: string | null; client: string; why: string; detail: string }

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`\nDatabase: ${safeUrl(url) || '(DATABASE_URL not set)'}`)
  console.log(APPLY ? 'Mode:     APPLY — changes will be written\n' : 'Mode:     dry run — nothing will be written\n')

  // Every class-enrolment line on a payment that actually succeeded. This is
  // the money we know arrived, and the enrolment it arrived for.
  const items = await prisma.paymentItem.findMany({
    where: {
      classEnrollmentId: { not: null },
      payment: { status: 'PAID', ...(TRAINER ? { trainerId: TRAINER } : {}) },
    },
    select: {
      id: true, unitAmount: true, quantity: true, classEnrollmentId: true,
      payment: { select: { id: true, paidAt: true, currency: true } },
      classEnrollment: { select: { id: true, ticketGroupId: true } },
    },
  })

  if (items.length === 0) {
    console.log('No paid class-enrolment payment lines found. Nothing to reconcile.')
    return
  }

  // An enrolment's invoice may hang off a SIBLING enrolment: a ticket basket
  // ("3 General + 3 VIP") is one row per type sharing a ticketGroupId, billed
  // as ONE invoice whose sourceId is the earliest of the group. So resolve
  // every enrolment that could own the invoice, not just this one.
  const enrolmentIds = items.map(i => i.classEnrollmentId!).filter(Boolean)
  const groupIds = [...new Set(items.map(i => i.classEnrollment?.ticketGroupId).filter(Boolean) as string[])]
  const siblings = groupIds.length
    ? await prisma.classEnrollment.findMany({
        where: { ticketGroupId: { in: groupIds } },
        select: { id: true, ticketGroupId: true },
      })
    : []
  const allSourceIds = [...new Set([...enrolmentIds, ...siblings.map(s => s.id)])]

  const invoices = await prisma.invoice.findMany({
    where: { sourceType: 'CLASS_ENROLLMENT', sourceId: { in: allSourceIds } },
    select: {
      id: true, sourceId: true, status: true, amountCents: true, amountPaidCents: true,
      currency: true, description: true, paymentId: true, paidAt: true,
      // Set when this invoice was folded into a combined one. That IS how a
      // trainer has been clearing these by hand, so it means "already dealt
      // with", not "needs attention" — see the CANCELLED branch below.
      mergedIntoId: true,
      client: { select: { user: { select: { name: true, email: true } } } },
    },
  })
  const invoiceBySource = new Map(invoices.map(i => [i.sourceId!, i]))
  // enrolment id -> the invoice that bills it (its own, or its basket's).
  const groupOf = new Map(siblings.map(s => [s.id, s.ticketGroupId!]))
  const invoiceForEnrolment = (enrolmentId: string) => {
    const direct = invoiceBySource.get(enrolmentId)
    if (direct) return direct
    const g = groupOf.get(enrolmentId)
    if (!g) return null
    for (const s of siblings) {
      if (s.ticketGroupId === g) {
        const inv = invoiceBySource.get(s.id)
        if (inv) return inv
      }
    }
    return null
  }

  // Fold every funding line onto the invoice it belongs to.
  const funding = new Map<string, { cents: number; paymentIds: Set<string>; paidAt: Date | null }>()
  const skipped: Skipped[] = []

  for (const it of items) {
    const inv = invoiceForEnrolment(it.classEnrollmentId!)
    if (!inv) {
      skipped.push({
        invoiceId: null,
        client: '—',
        why: 'no invoice',
        detail: `enrolment ${it.classEnrollmentId} was paid for but has no invoice — a different problem from this one`,
      })
      continue
    }
    const f = funding.get(inv.id) ?? { cents: 0, paymentIds: new Set<string>(), paidAt: null }
    f.cents += it.unitAmount * it.quantity
    f.paymentIds.add(it.payment.id)
    if (it.payment.paidAt && (!f.paidAt || it.payment.paidAt < f.paidAt)) f.paidAt = it.payment.paidAt
    funding.set(inv.id, f)
  }

  const candidates: Candidate[] = []
  // Already handled by a human — reported so a run is accountable for every
  // invoice it saw, but never counted as outstanding.
  const resolved: Skipped[] = []

  for (const inv of invoices) {
    const f = funding.get(inv.id)
    if (!f) continue
    const who = inv.client?.user?.name?.trim() || inv.client?.user?.email || 'unknown client'

    if (inv.status === 'PAID') continue // already right
    // Folded into a combined invoice — the money is recorded over there, and
    // this row is CANCELLED precisely because it was dealt with. Reporting it
    // as needing attention sends someone chasing settled money, which is how a
    // reconciliation tool stops being trusted.
    if (inv.mergedIntoId) {
      resolved.push({ invoiceId: inv.id, client: who, why: 'merged', detail: `folded into ${inv.mergedIntoId}` })
      continue
    }
    if (inv.status === 'CANCELLED') {
      skipped.push({ invoiceId: inv.id, client: who, why: 'cancelled', detail: 'invoice is CANCELLED but was not merged into another — a human should decide' })
      continue
    }
    if (f.paymentIds.size > 1) {
      skipped.push({
        invoiceId: inv.id, client: who, why: 'several payments',
        detail: `funded by ${f.paymentIds.size} payments (${[...f.paymentIds].join(', ')}) — only one can be recorded, so a human should allocate it`,
      })
      continue
    }
    // Nothing to do: already credited with at least what these lines paid.
    if (inv.amountPaidCents >= f.cents && inv.paymentId) continue

    const next = applyPaidAmount({ amountCents: inv.amountCents }, f.cents)
    if (next.status !== 'PAID') {
      skipped.push({
        invoiceId: inv.id, client: who, why: 'would not fully settle',
        detail: `lines total ${money(f.cents, inv.currency)} against ${money(inv.amountCents, inv.currency)} — part-payment, left for a human`,
      })
      continue
    }

    candidates.push({
      invoiceId: inv.id,
      client: who,
      description: inv.description ?? '—',
      currency: inv.currency,
      amountCents: inv.amountCents,
      amountPaidCents: inv.amountPaidCents,
      status: inv.status,
      fundedCents: f.cents,
      paymentIds: [...f.paymentIds],
      nextStatus: next.status,
      nextPaidCents: next.amountPaidCents,
    })
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ candidates, skipped, resolved, applied: APPLY }, null, 2))
  } else {
    console.log(`Scanned ${items.length} paid enrolment lines across ${invoices.length} invoices.\n`)
    if (candidates.length === 0) {
      console.log('Nothing to repair — every paid enrolment invoice is already settled.')
    } else {
      console.log(`${candidates.length} invoice${candidates.length === 1 ? '' : 's'} paid but not marked paid:\n`)
      for (const c of candidates) {
        console.log(`  ${c.invoiceId}  ${c.client}`)
        console.log(`      ${c.description}`)
        console.log(`      ${c.status} ${money(c.amountPaidCents, c.currency)} of ${money(c.amountCents, c.currency)}`
          + `  ->  PAID ${money(c.nextPaidCents, c.currency)}   (payment ${c.paymentIds[0]})`)
      }
      const total = candidates.reduce((s, c) => s + (c.nextPaidCents - c.amountPaidCents), 0)
      const cur = candidates[0].currency
      const mixed = candidates.some(c => c.currency !== cur)
      console.log(`\n  Total to record: ${mixed ? `${(total / 100).toFixed(2)} (mixed currencies — check individually)` : money(total, cur)}`)
    }
    if (resolved.length) {
      console.log(`\n${resolved.length} already settled by hand (merged into a combined invoice) — nothing to do:\n`)
      for (const r of resolved) console.log(`  ${r.invoiceId}  ${r.client} — ${r.detail}`)
    }
    if (skipped.length) {
      console.log(`\n${skipped.length} left for a human:\n`)
      for (const s of skipped) console.log(`  ${s.invoiceId ?? '(no invoice)'}  ${s.why} — ${s.detail}`)
    }
  }

  if (!APPLY) {
    if (candidates.length) console.log('\nRe-run with --apply to write these changes.')
    return
  }

  let done = 0
  for (const c of candidates) {
    const f = funding.get(c.invoiceId)!
    try {
      await prisma.invoice.update({
        where: { id: c.invoiceId },
        data: {
          amountPaidCents: c.nextPaidCents,
          status: c.nextStatus,
          paidAt: f.paidAt ?? new Date(),
          paymentId: c.paymentIds[0],
        },
      })
      done++
    } catch (e) {
      // Loud, and keeps going — one bad row must not strand the rest.
      console.error(`  FAILED ${c.invoiceId}:`, e instanceof Error ? e.message : e)
    }
  }
  console.log(`\nUpdated ${done} of ${candidates.length} invoice${candidates.length === 1 ? '' : 's'}.`)
  if (done < candidates.length) {
    console.log('Some failed — if the error mentions a unique constraint on paymentId,')
    console.log('the 20260730000000_invoice_payment_many migration has not been applied to this database yet.')
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
