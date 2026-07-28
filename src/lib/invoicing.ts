import { after } from 'next/server'
import { prisma } from './prisma'
import { sendEmail } from './email'
import { sendPush } from './push'
import { estimateProcessingSurcharge } from './connect'
import { ensureClientXeroContact } from './xero-sync'
import { postPaymentThroughClearing, isSurchargeItem } from './xero-clearing'
import { createXeroInvoice, fetchXeroInvoiceState } from './xero'
import { sessionDropInPriceCents, wholeRunPriceCents } from './class-runs'
import { effectivePriceCents, isOnSale } from './product-price'
import { env } from './env'
import { currencySymbol } from './money'

// Payment-method-agnostic receivables. When a *priced* package or product is
// assigned to a client (trainer-assigns OR client self-purchase), we raise an
// UNPAID `Invoice` for it — regardless of whether the trainer uses Stripe. This
// lets bank-transfer / Xero-only trainers invoice + reconcile. Everything here
// is best-effort and NON-FATAL: a failure must never break the assignment that
// triggered it.
//
// Phase 1 scope: create the receivable, optionally email it (autoSendInvoices),
// and mirror it into Xero when connected. Stripe pay-link on send + bank-transfer
// reconciliation are Phase 2 — the `paymentId` link + status field are left ready.

const ACCENT = '#0d9488'

function money(minor: number, currency: string): string {
  return `${currencySymbol(currency)}${(minor / 100).toFixed(2)}`
}

/**
 * Run the after-the-response side effects (client email, Xero push).
 *
 * `after()` only exists inside a request scope, and throws outside one. That's
 * fine in the app — every caller is a route — but it means none of this file
 * can be driven from a script or a test without blowing up AFTER the invoice
 * row has already been written, which reads as "the invoice wasn't created"
 * when it was. Outside a request we just run them inline instead.
 */
function deferSideEffects(fn: () => void): void {
  try {
    after(fn)
  } catch {
    fn()
  }
}

export interface AssignmentInvoiceInput {
  trainerId: string
  clientId: string
  sourceType: 'PACKAGE' | 'PRODUCT' | 'CLASS_ENROLLMENT'
  // Exactly one of these, matching sourceType. Also the idempotency sourceId.
  clientPackageId?: string
  productId?: string
  classEnrollmentId?: string
  /**
   * Whether to email the client about this invoice. Default true.
   *
   * Set false when the CALLER is already emailing them — booking someone into a
   * package or class sends "You're booked in" carrying the same Pay now link,
   * so letting the invoice email fire too meant two emails, seconds apart,
   * asking for the same money. The invoice is still marked sent, because the
   * client genuinely has been given the link.
   */
  notifyClient?: boolean
}

/**
 * Idempotently raise an UNPAID receivable for a priced package/product
 * assignment. Returns the invoice id (existing or new), or null when there's
 * nothing to invoice (no price, or the source can't be resolved).
 *
 * Best-effort: swallows and logs all errors so a Xero/email/DB hiccup never
 * rolls back or blocks the assignment. Call it AFTER the assignment has
 * committed.
 */
export async function createInvoiceForAssignment(input: AssignmentInvoiceInput): Promise<string | null> {
  try {
    const sourceId =
      input.sourceType === 'PACKAGE' ? input.clientPackageId
      : input.sourceType === 'CLASS_ENROLLMENT' ? input.classEnrollmentId
      : input.productId
    if (!sourceId) return null

    // Resolve the amount + label. (The per-source Xero account code is resolved
    // independently in syncReceivableToXero, so we don't carry it here.)
    let amountCents: number | null = null
    let description = ''
    // Most assignments are one of a thing at its price. An event ticket can be
    // several ("2 × General"), and the invoice has to show that rather than a
    // mystery doubled total — so the line quantity/unit price are carried out
    // of the resolution below instead of being assumed to be 1 × amount.
    let quantity = 1
    let unitAmountCents: number | null = null
    // A ticketed event bought as a basket ("3 General + 3 VIP") is several
    // enrolment rows sharing a ticketGroupId, and it must read as ONE invoice
    // with a line per ticket type. When that's what we're looking at, the
    // CLASS_ENROLLMENT branch fills these two in and the single-line default
    // below is skipped.
    let extraLines: { description: string; quantity: number; unitAmountCents: number; amountCents: number; xeroAccountCode: string | null }[] | null = null
    // Which enrolment ids this invoice covers. Idempotency is checked across
    // ALL of them, so raising the invoice for the second ticket type in a
    // basket finds the one already covering the first instead of billing twice.
    let idempotencySourceIds: string[] = [sourceId]
    // The row the invoice hangs off. For a basket it's the earliest of the
    // group, so whichever member triggered this lands on the same invoice.
    let effectiveSourceId = sourceId

    if (input.sourceType === 'PACKAGE') {
      const cp = await prisma.clientPackage.findFirst({
        where: { id: sourceId, clientId: input.clientId },
        select: { package: { select: { name: true, priceCents: true, specialPriceCents: true } } },
      })
      if (!cp) return null
      amountCents = cp.package.specialPriceCents ?? cp.package.priceCents
      description = cp.package.name
    } else if (input.sourceType === 'CLASS_ENROLLMENT') {
      // A class enrolment prices off the run's backing group package: a FULL seat
      // is the package (special) price; a DROP_IN is the price of the ONE
      // session they booked — its schedule slot's, so a drop-in class can charge
      // more for a Saturday than a Tuesday, falling back to the package's flat
      // drop-in rate for a classic class that just allows drop-ins.
      //
      // An EVENT is the exception: it sells named ticket types at their own
      // prices, and can be bought several at a time — several TYPES at a time,
      // even ("3 General + 3 VIP", one row per type, sharing a ticketGroupId).
      // When the enrolment names a ticket, THAT price × quantity is the bill;
      // the package's flat price is only the fallback for everything that
      // doesn't sell tickets.
      const enr = await prisma.classEnrollment.findFirst({
        where: { id: sourceId, clientId: input.clientId },
        select: {
          type: true, joinedAtIndex: true, quantity: true, ticketGroupId: true,
          ticketTier: { select: { name: true, priceCents: true } },
          dropInSession: { select: { packageSessionSlot: { select: { priceCents: true, specialPriceCents: true } } } },
          classRun: {
            select: {
              id: true,
              name: true,
              package: {
                select: {
                  priceCents: true, specialPriceCents: true, dropInPriceCents: true,
                  // allowDropIn marks a class priced PER SESSION. A FULL seat on
                  // one is billed from the run's sessions, not from priceCents.
                  allowDropIn: true,
                },
              },
            },
          },
        },
      })
      if (!enr) return null
      const pkg = enr.classRun.package

      // Several ticket types bought in one action: one invoice, a line per type,
      // each priced off its OWN tier. Never the offering's flat price — that
      // mismatch is the bug fixed in d736544 ($45 charged for a $200 ticket).
      const group = enr.ticketGroupId
        ? await prisma.classEnrollment.findMany({
            where: { ticketGroupId: enr.ticketGroupId, clientId: input.clientId },
            orderBy: [{ enrolledAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true, quantity: true,
              ticketTier: { select: { name: true, priceCents: true, xeroAccountCode: true } },
            },
          })
        : []
      if (group.length > 1) {
        idempotencySourceIds = group.map(g => g.id)
        effectiveSourceId = group[0].id
        extraLines = group.map((g) => {
          const unit = g.ticketTier?.priceCents ?? 0
          const qty = Math.max(1, g.quantity ?? 1)
          return {
            description: `${enr.classRun.name} (${g.ticketTier?.name ?? 'Ticket'}${qty > 1 ? ` × ${qty}` : ''})`,
            quantity: qty,
            unitAmountCents: unit,
            amountCents: unit * qty,
            // A ticket type can post to its own income account, and in a basket
            // the types can differ — so the code goes on the LINE rather than
            // being resolved once for the whole invoice.
            xeroAccountCode: g.ticketTier?.xeroAccountCode ?? null,
          }
        })
        amountCents = extraLines.reduce((n, l) => n + l.amountCents, 0)
        const totalTickets = extraLines.reduce((n, l) => n + l.quantity, 0)
        description = `${enr.classRun.name} (${totalTickets} ticket${totalTickets === 1 ? '' : 's'})`
      } else {
        // A class enrolment prices off the run's backing group package: a FULL seat
        // is the package (special) price; a DROP_IN is the price of the ONE
        // session they booked. A single named ticket is that ticket's price.
        //
        // The per-session fallback on the FULL branch is not a nicety. A CASUAL
        // class carries its price per session — the trainer types it into the
        // session row, and it lands on the slot (and in dropInPriceCents), while
        // the package's own priceCents stays null because there is no
        // whole-course price to set. Enrol someone as FULL on such a class and
        // this read returned null, so invoicing refused with "this class has no
        // price set" while £30 sat on screen in the price box. Reported by a
        // live customer who could not bill a casual class at all.
        //
        // But a FULL seat is the WHOLE RUN, so falling back to the per-session
        // price and billing it once undercharged by every session bar one — a
        // six-week casual class billed as £30 instead of £180. Same customer,
        // and the direct cost of the fix above. The whole run is the sum of its
        // sessions, taken slot by slot because a casual class is free to price
        // each session differently.
        quantity = Math.max(1, enr.quantity ?? 1)
        // A class priced PER SESSION (allowDropIn) has no whole-course price to
        // read: the pricing card is hidden on its edit form, so any figure left
        // in priceCents is stale — typed before the class became a casual one,
        // and invisible to the trainer ever since. Reading it billed a full run
        // as a single session. Same reasoning as ticket tiers, which have
        // overridden priceCents outright since d736544 and for the same reason.
        const fullSeatCents = pkg.allowDropIn
          ? (await wholeRunPriceCents(enr.classRun.id, pkg)) ?? pkg.specialPriceCents ?? pkg.priceCents
          : (pkg.specialPriceCents ?? pkg.priceCents ?? await wholeRunPriceCents(enr.classRun.id, pkg))
        unitAmountCents = enr.ticketTier
          ? enr.ticketTier.priceCents
          : enr.type === 'DROP_IN'
            ? sessionDropInPriceCents(enr.dropInSession?.packageSessionSlot, pkg)
            : fullSeatCents
        amountCents = unitAmountCents == null ? null : unitAmountCents * quantity
        const ticketNote = enr.ticketTier
          ? ` (${enr.ticketTier.name}${quantity > 1 ? ` × ${quantity}` : ''})`
          : enr.type === 'DROP_IN'
            ? ` (drop-in${enr.joinedAtIndex ? ` · session ${enr.joinedAtIndex}` : ''})`
            : ''
        description = enr.classRun.name + ticketNote
      }
    } else {
      const product = await prisma.product.findFirst({
        where: { id: sourceId, trainerId: input.trainerId },
        select: { name: true, priceCents: true, salePriceCents: true },
      })
      if (!product) return null
      // On sale means on sale on the invoice too — same rule as a package's
      // specialPriceCents a few branches up.
      amountCents = effectivePriceCents(product)
      description = isOnSale(product) ? `${product.name} (sale)` : product.name
    }

    // Skip free / unpriced items — nothing to invoice.
    if (!amountCents || amountCents <= 0) return null

    // Idempotency: at most one invoice per (trainer, client, source). A repeat
    // assignment of the same source is a no-op (returns the existing id) and
    // never re-sends.
    // `sourceId: { in: … }` rather than a plain equality: a basket of ticket
    // types is several enrolment rows covered by ONE invoice, and asking for the
    // second row's invoice has to find the first's rather than raise a duplicate.
    const existing = await prisma.invoice.findFirst({
      where: {
        trainerId: input.trainerId,
        clientId: input.clientId,
        sourceType: input.sourceType,
        sourceId: idempotencySourceIds.length > 1 ? { in: idempotencySourceIds } : sourceId,
      },
      select: { id: true },
    })
    if (existing) return existing.id

    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: input.trainerId },
      select: {
        autoSendInvoices: true,
        payoutCurrency: true,
        businessName: true,
        sandboxBilling: true,
        xeroConnection: { select: { id: true } },
      },
    })
    if (!trainer) return null

    const currency = trainer.payoutCurrency ?? 'nzd'
    const autoSend = trainer.autoSendInvoices === true
    // The caller may already be telling the client (see notifyClient).
    const emailClient = autoSend && input.notifyClient !== false

    const invoice = await prisma.invoice.create({
      data: {
        trainerId: input.trainerId,
        clientId: input.clientId,
        amountCents,
        currency,
        status: 'UNPAID',
        description,
        sourceType: input.sourceType,
        sourceId: effectiveSourceId,
        sentAt: autoSend ? new Date() : null,
        // Every invoice has >=1 line. Assignment invoices start with a single
        // line for the package/product; the trainer can add more in the editor.
        // A basket of event tickets is the one multi-line case — a line per
        // ticket type, so the client reads "General × 3" and "VIP × 3" rather
        // than one mystery total.
        lines: {
          create: extraLines
            ? extraLines.map((l, i) => ({ ...l, sortOrder: i }))
            : [{
                description,
                quantity,
                // Falls back to the total for the single-item sources, which is the
                // same number when quantity is 1.
                unitAmountCents: unitAmountCents ?? amountCents,
                amountCents,
                sortOrder: 0,
              }],
        },
      },
      select: { id: true, payToken: true },
    })

    // Side effects (client email + Xero push) run AFTER the response so the
    // booking/assignment that triggered this never blocks on Resend/Xero network
    // round-trips (which made self-book feel slow). The invoice row itself is
    // already committed above; these are best-effort and never affect it.
    const xeroEnabled = !!trainer.xeroConnection && (!trainer.sandboxBilling || process.env.NODE_ENV === 'development')
    deferSideEffects(() => {
      const tasks: Promise<unknown>[] = []
      if (emailClient) {
        tasks.push(notifyClientOfInvoice({
          trainerId: input.trainerId,
          clientId: input.clientId,
          businessName: trainer.businessName ?? 'Your trainer',
          description,
          amountCents,
          currency,
          payToken: invoice.payToken,
        }).catch((e) => console.error('[invoicing] notify failed', invoice.id, e)))
      }
      // Mirror into Xero when connected. Sandbox/demo trainers are skipped in
      // prod (never hit a real org) but allowed in local dev for testing.
      if (xeroEnabled) {
        tasks.push(syncReceivableToXero(invoice.id).catch((e) => console.error('[invoicing] xero push failed', invoice.id, e)))
      }
      return Promise.all(tasks)
    })

    return invoice.id
  } catch (err) {
    console.error('[invoicing] createInvoiceForAssignment failed', input, err)
    return null
  }
}

export interface ManualSaleLine {
  description: string
  quantity: number
  unitAmountCents: number
  xeroAccountCode?: string | null
}

export interface ManualSaleInput {
  trainerId: string
  clientId: string
  /** Arbitrary lines — products picked from the catalogue and/or free-text items. */
  lines: ManualSaleLine[]
  /**
   * Caller-generated key that makes the sale idempotent. Stored as `sourceId`
   * against sourceType 'MANUAL'. A POS sale is rung up on a phone, mid-groom —
   * a double-tap or a retry on a flaky connection must never raise (or charge)
   * two invoices, and unlike the assignment flows there's no natural source row
   * to key off.
   */
  idempotencyKey: string
}

/**
 * Raise an UNPAID receivable for an ad-hoc, trainer-initiated IN-PERSON sale —
 * the "instant sale" (POS) flow. Unlike createInvoiceForAssignment (priced off a
 * package/product) and createCancellationFeeInvoice (a single fixed fee), the
 * lines here are arbitrary and multi-item: whatever the trainer rang up.
 *
 * The invoice is payable immediately through the existing /pay/<payToken> page —
 * the trainer shows that link as a QR code and the client pays on their own
 * phone, which mints a Stripe Checkout Session via the same direct-charge path
 * as every other purchase. No new Stripe code, and nothing to install.
 *
 * Idempotent on (trainer, client, 'MANUAL', idempotencyKey).
 *
 * NOT best-effort, unlike its siblings in this file: this IS the trainer's
 * action rather than a side effect of one, so a failure must surface instead of
 * silently returning null and leaving them to think the sale went through.
 * Throws on failure; the route maps that to a 500. The post-commit side effects
 * (client email, Xero push) stay best-effort and never block the sale.
 */
export async function createManualSaleInvoice(
  input: ManualSaleInput,
): Promise<{ id: string; payToken: string | null; amountCents: number }> {
  if (input.lines.length === 0) throw new Error('a sale needs at least one line')

  // Scope the client to this trainer — an id alone must never be enough to
  // invoice someone else's client.
  const client = await prisma.clientProfile.findFirst({
    where: { id: input.clientId, trainerId: input.trainerId },
    select: { id: true },
  })
  if (!client) throw new Error('client not found for this trainer')

  const lines = input.lines.map((l, i) => ({
    description: l.description,
    quantity: l.quantity,
    unitAmountCents: l.unitAmountCents,
    amountCents: l.quantity * l.unitAmountCents,
    xeroAccountCode: l.xeroAccountCode ?? null,
    sortOrder: i,
  }))
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0)
  if (amountCents <= 0) throw new Error('a sale needs a total above zero')

  // Idempotency: same key ⇒ same invoice, never a second one.
  const existing = await prisma.invoice.findFirst({
    where: {
      trainerId: input.trainerId,
      clientId: input.clientId,
      sourceType: 'MANUAL',
      sourceId: input.idempotencyKey,
    },
    select: { id: true, payToken: true, amountCents: true },
  })
  if (existing) return existing

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: input.trainerId },
    select: {
      autoSendInvoices: true,
      payoutCurrency: true,
      businessName: true,
      sandboxBilling: true,
      xeroConnection: { select: { id: true } },
    },
  })
  if (!trainer) throw new Error('trainer not found')

  const currency = trainer.payoutCurrency ?? 'nzd'
  const autoSend = trainer.autoSendInvoices === true
  // The first line labels the invoice, matching the assignment flows; a
  // multi-item sale reads as "Ball thrower +2 more".
  const description = lines.length === 1
    ? lines[0].description
    : `${lines[0].description} +${lines.length - 1} more`

  const invoice = await prisma.invoice.create({
    data: {
      trainerId: input.trainerId,
      clientId: input.clientId,
      amountCents,
      currency,
      status: 'UNPAID',
      description,
      sourceType: 'MANUAL',
      sourceId: input.idempotencyKey,
      sentAt: autoSend ? new Date() : null,
      lines: { create: lines },
    },
    select: { id: true, payToken: true, amountCents: true },
  })

  // Same post-commit pattern as the assignment flow: never make the trainer
  // stand there while Resend/Xero round-trip.
  const xeroEnabled = !!trainer.xeroConnection && (!trainer.sandboxBilling || process.env.NODE_ENV === 'development')
  deferSideEffects(() => {
    const tasks: Promise<unknown>[] = []
    if (autoSend) {
      tasks.push(notifyClientOfInvoice({
        trainerId: input.trainerId,
        clientId: input.clientId,
        businessName: trainer.businessName ?? 'Your trainer',
        description,
        amountCents,
        currency,
        payToken: invoice.payToken,
      }).catch((e) => console.error('[invoicing] manual sale notify failed', invoice.id, e)))
    }
    if (xeroEnabled) {
      tasks.push(syncReceivableToXero(invoice.id).catch((e) => console.error('[invoicing] manual sale xero push failed', invoice.id, e)))
    }
    return Promise.all(tasks)
  })

  return invoice
}

/**
 * Raise a fixed-amount receivable for a client-initiated CANCELLATION FEE. Unlike
 * createInvoiceForAssignment (which prices off the package/product/class), the
 * amount here is passed in — the fee the trainer configured — so we don't reuse
 * that helper's price-resolution. Everything else matches: an UNPAID Invoice with
 * one line, optionally auto-sent to the client, and best-effort mirrored into Xero,
 * payable through the same /pay/<payToken> flow.
 *
 * Idempotent on (trainer, client, 'CANCELLATION_FEE', sourceId) — sourceId is the
 * cancelled session or enrolment id, so a double-cancel never double-charges.
 * Best-effort and NON-FATAL: swallows/logs errors so a Xero/email/DB hiccup can't
 * break the cancellation that triggered it. Returns the invoice id, or null when
 * there's nothing to raise (no amount, or the trainer/client can't be resolved).
 */
export async function createCancellationFeeInvoice(input: {
  trainerId: string
  clientId: string
  amountCents: number
  sourceId: string
  description: string
}): Promise<string | null> {
  try {
    if (!input.amountCents || input.amountCents <= 0) return null

    const existing = await prisma.invoice.findFirst({
      where: { trainerId: input.trainerId, clientId: input.clientId, sourceType: 'CANCELLATION_FEE', sourceId: input.sourceId },
      select: { id: true },
    })
    if (existing) return existing.id

    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: input.trainerId },
      select: {
        autoSendInvoices: true,
        payoutCurrency: true,
        businessName: true,
        sandboxBilling: true,
        xeroConnection: { select: { id: true } },
      },
    })
    if (!trainer) return null

    const currency = trainer.payoutCurrency ?? 'nzd'
    const autoSend = trainer.autoSendInvoices === true
    const description = input.description

    const invoice = await prisma.invoice.create({
      data: {
        trainerId: input.trainerId,
        clientId: input.clientId,
        amountCents: input.amountCents,
        currency,
        status: 'UNPAID',
        description,
        sourceType: 'CANCELLATION_FEE',
        sourceId: input.sourceId,
        sentAt: autoSend ? new Date() : null,
        lines: {
          create: [{ description, quantity: 1, unitAmountCents: input.amountCents, amountCents: input.amountCents, sortOrder: 0 }],
        },
      },
      select: { id: true, payToken: true },
    })

    const xeroEnabled = !!trainer.xeroConnection && (!trainer.sandboxBilling || process.env.NODE_ENV === 'development')
    deferSideEffects(() => {
      const tasks: Promise<unknown>[] = []
      if (autoSend) {
        tasks.push(notifyClientOfInvoice({
          trainerId: input.trainerId,
          clientId: input.clientId,
          businessName: trainer.businessName ?? 'Your trainer',
          description,
          amountCents: input.amountCents,
          currency,
          payToken: invoice.payToken,
        }).catch((e) => console.error('[invoicing] cancel-fee notify failed', invoice.id, e)))
      }
      if (xeroEnabled) {
        tasks.push(syncReceivableToXero(invoice.id).catch((e) => console.error('[invoicing] cancel-fee xero push failed', invoice.id, e)))
      }
      return Promise.all(tasks)
    })

    return invoice.id
  } catch (err) {
    console.error('[invoicing] createCancellationFeeInvoice failed', input, err)
    return null
  }
}

/**
 * Notify a client that a receivable has been issued: in-app notification, push,
 * and a branded email with a "Pay now" CTA to the public pay page
 * (/pay/<payToken>, no login required). Invoice notifications aren't
 * user-suppressible, so we send directly.
 */
export async function notifyClientOfInvoice(args: {
  trainerId: string
  clientId: string
  businessName: string
  description: string
  amountCents: number
  currency: string
  payToken: string | null
}): Promise<void> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { userId: true, user: { select: { email: true } } },
  })
  if (!client) return

  // If the trainer passes the card fee on, the pay page and Stripe both charge
  // invoice + surcharge — so the email must quote the same number. Otherwise a
  // client reads "$50", clicks through, and is asked for $51.85.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: args.trainerId },
    select: { passProcessingFeeToClient: true, acceptPaymentsEnabled: true, connectChargesEnabled: true },
  })
  const canTakeCard = !!(trainer?.acceptPaymentsEnabled && trainer?.connectChargesEnabled)
  const surcharge = canTakeCard && trainer?.passProcessingFeeToClient
    ? estimateProcessingSurcharge(args.amountCents, args.currency)
    : 0

  const amountStr = money(args.amountCents, args.currency)
  const cardTotalStr = surcharge > 0 ? money(args.amountCents + surcharge, args.currency) : null
  const feeStr = surcharge > 0 ? money(surcharge, args.currency) : null
  const title = `New invoice: ${amountStr}`
  const body = `${args.businessName} has sent you an invoice for ${amountStr} — ${args.description}.${
    cardTotalStr ? ` Paying by card adds a ${feeStr} processing fee — ${cardTotalStr} in total.` : ''
  }`
  // The public pay page is the destination; fall back to the app home only if a
  // (legacy) invoice somehow has no token.
  const payLink = args.payToken ? `${env.NEXT_PUBLIC_APP_URL}/pay/${args.payToken}` : `${env.NEXT_PUBLIC_APP_URL}/my`

  if (client.userId) {
    await prisma.notification.create({ data: { userId: client.userId, title, body, link: payLink } }).catch(() => {})
    await sendPush(client.userId, { alert: { title, body }, customData: { path: payLink } }).catch(() => {})
  }
  if (client.user?.email) {
    await sendEmail({
      to: client.user.email,
      subject: `${args.businessName}: new invoice`,
      html: invoiceEmail(args.businessName, args.description, amountStr, args.payToken ? payLink : null, feeStr, cardTotalStr),
      text: `${body}${args.payToken ? `\n\nPay now: ${payLink}` : ''}`,
    }).catch(() => {})
  }
}

/**
 * Mirror a receivable Invoice into the trainer's Xero org as an AUTHORISED ACCREC
 * invoice. Idempotent (an invoice that already has a xeroInvoiceId is returned
 * as-is) and best-effort — records SYNCED / ERROR (+ message) on the Invoice so
 * failures are retriable/surfaceable; a no-op when the trainer isn't connected.
 */
export type ReceivableSyncResult = { ok: boolean; xeroInvoiceId?: string; error?: string }

/**
 * Push a receivable into Xero on creation. Idempotent — an invoice that already
 * has a xeroInvoiceId is returned as-is (use resyncReceivableToXero to push an
 * edit).
 */
export async function syncReceivableToXero(invoiceId: string): Promise<ReceivableSyncResult> {
  return pushReceivableToXero(invoiceId, false)
}

/**
 * Re-push an EDITED receivable to Xero, updating the existing Xero invoice in
 * place (Xero's POST /Invoices upserts on InvoiceID; AUTHORISED unpaid invoices
 * are editable). A no-op when the invoice was never synced (no xeroInvoiceId) —
 * the edit will still be captured whenever it first syncs. Best-effort.
 */
export async function resyncReceivableToXero(invoiceId: string): Promise<ReceivableSyncResult> {
  return pushReceivableToXero(invoiceId, true)
}

async function pushReceivableToXero(invoiceId: string, updateExisting: boolean): Promise<ReceivableSyncResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, clientId: true, description: true, amountCents: true,
      sourceType: true, sourceId: true, xeroInvoiceId: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: { description: true, quantity: true, unitAmountCents: true, xeroAccountCode: true },
      },
      trainer: { select: { sandboxBilling: true, xeroConnection: true } },
    },
  })
  if (!invoice) return { ok: false, error: 'invoice not found' }
  // Create path is idempotent: an already-synced invoice short-circuits. The
  // resync path instead reuses the existing id to update the invoice in place.
  if (invoice.xeroInvoiceId && !updateExisting) return { ok: true, xeroInvoiceId: invoice.xeroInvoiceId }
  if (updateExisting && !invoice.xeroInvoiceId) return { ok: true } // never synced → nothing to update
  // Never sync demo/sandbox trainers' data into a real Xero org — except in
  // local dev, where testing against the connected (throwaway) demo org is the
  // whole point. Keep this in step with the caller guard in createInvoiceForAssignment.
  if (invoice.trainer.sandboxBilling && process.env.NODE_ENV !== 'development') return { ok: false, error: 'sandbox' }

  const connection = invoice.trainer.xeroConnection
  if (!connection) return { ok: false, error: 'not connected' } // leave xeroSyncStatus null

  try {
    const contactId = await ensureClientXeroContact(invoice.clientId)
    if (!contactId) throw new Error('Could not resolve the client’s Xero contact.')

    // Resolve the invoice-level source account once (the package/product's own
    // code). Each line falls back to it, then to the connection's default sales
    // account.
    let sourceCode: string | null = null
    if (invoice.sourceType === 'PACKAGE' && invoice.sourceId) {
      const cp = await prisma.clientPackage.findUnique({
        where: { id: invoice.sourceId },
        select: { package: { select: { xeroAccountCode: true } } },
      })
      sourceCode = cp?.package?.xeroAccountCode ?? null
    } else if (invoice.sourceType === 'PRODUCT' && invoice.sourceId) {
      const product = await prisma.product.findUnique({
        where: { id: invoice.sourceId },
        select: { xeroAccountCode: true },
      })
      sourceCode = product?.xeroAccountCode ?? null
    } else if (invoice.sourceType === 'CLASS_ENROLLMENT' && invoice.sourceId) {
      const enr = await prisma.classEnrollment.findUnique({
        where: { id: invoice.sourceId },
        select: {
          ticketTier: { select: { xeroAccountCode: true } },
          classRun: { select: { package: { select: { xeroAccountCode: true } } } },
        },
      })
      // An event's ticket type can post to its own income account (a workshop
      // sold alongside merch), so it wins over the offering's.
      sourceCode = enr?.ticketTier?.xeroAccountCode || enr?.classRun?.package?.xeroAccountCode || null
    }

    // Fall back to a single synthetic line if (unexpectedly) the invoice has no
    // line rows — keeps a legacy/edge invoice syncing rather than failing.
    const lineRows = invoice.lines.length
      ? invoice.lines
      : [{ description: invoice.description ?? 'Invoice', quantity: 1, unitAmountCents: invoice.amountCents, xeroAccountCode: null }]

    const lines = lineRows.map((l) => {
      const code = l.xeroAccountCode || sourceCode || connection.salesAccountCode
      if (!code) {
        throw new Error('No Xero income account is mapped. Set a default income account in Settings → Integrations.')
      }
      return {
        description: l.description,
        quantity: l.quantity,
        unitAmountMinor: l.unitAmountCents,
        accountCode: code,
        taxType: connection.taxType,
      }
    })

    const xeroInvoiceId = await createXeroInvoice(connection, {
      // On resync, pass the existing id so Xero updates the invoice in place.
      invoiceId: updateExisting ? invoice.xeroInvoiceId : null,
      contactId,
      reference: invoice.id,
      hasTax: !!connection.taxType,
      lines,
    })

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { xeroInvoiceId, xeroSyncStatus: 'SYNCED', xeroSyncError: null },
    })
    return { ok: true, xeroInvoiceId }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Xero sync failed'
    console.error('[invoicing] pushReceivableToXero failed', invoiceId, err)
    await prisma.invoice
      .update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } })
      .catch(() => {})
    return { ok: false, error }
  }
}

// ─── Inbound reconciliation (Xero → PupManager payment status) ────────────────

/**
 * Decide an invoice's payment status from how much has been paid against its
 * total. Overpayment clamps to PAID; a full payment stamps paidAt; a partial
 * payment is PARTIAL (no paidAt); nothing paid is UNPAID. `amountPaidCents` in
 * the result is clamped into [0, total] for a clean "$X of $Y" display.
 */
export function applyPaidAmount(
  invoice: { amountCents: number },
  amountPaidCents: number,
): { status: 'UNPAID' | 'PARTIAL' | 'PAID'; paidAt: Date | null; amountPaidCents: number } {
  const total = invoice.amountCents
  const clamped = Math.max(0, Math.min(amountPaidCents, total))
  if (total > 0 && amountPaidCents >= total) return { status: 'PAID', paidAt: new Date(), amountPaidCents: total }
  if (clamped <= 0) return { status: 'UNPAID', paidAt: null, amountPaidCents: 0 }
  return { status: 'PARTIAL', paidAt: null, amountPaidCents: clamped }
}

export type ReconcileResult = { ok: boolean; changed?: boolean; status?: string; amountPaidCents?: number; error?: string }

/**
 * Pull one invoice's payment state from Xero and reflect it locally
 * (amountPaidCents / status / paidAt). Best-effort — never throws; records
 * SYNCED / ERROR. No-op when the invoice isn't Xero-synced, is CANCELLED, the
 * trainer isn't connected, or (in prod) is a sandbox/demo trainer.
 */
export async function reconcileXeroPayment(invoiceId: string): Promise<ReconcileResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, amountCents: true, amountPaidCents: true, status: true, paidAt: true, xeroInvoiceId: true,
      trainer: { select: { sandboxBilling: true, xeroConnection: true } },
    },
  })
  if (!invoice) return { ok: false, error: 'invoice not found' }
  if (!invoice.xeroInvoiceId) return { ok: false, error: 'not synced' }
  if (invoice.status === 'CANCELLED') return { ok: false, error: 'cancelled' }
  // Same guard as the push path — never touch a real Xero org for demo trainers
  // in prod, but allow it in local dev against the throwaway demo org.
  if (invoice.trainer.sandboxBilling && process.env.NODE_ENV !== 'development') return { ok: false, error: 'sandbox' }

  const connection = invoice.trainer.xeroConnection
  if (!connection) return { ok: false, error: 'not connected' }

  try {
    const state = await fetchXeroInvoiceState(connection, invoice.xeroInvoiceId)
    if (!state) return { ok: true, changed: false } // invoice gone in Xero → leave as-is

    const next = applyPaidAmount({ amountCents: invoice.amountCents }, state.amountPaidCents)
    // Keep the original settlement time when it's already fully paid.
    const paidAt = next.status === 'PAID' ? invoice.paidAt ?? next.paidAt : null
    const changed = next.status !== invoice.status || next.amountPaidCents !== invoice.amountPaidCents

    if (changed) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaidCents: next.amountPaidCents,
          status: next.status,
          paidAt,
          xeroSyncStatus: 'SYNCED',
          xeroSyncError: null,
        },
      })
    }
    return { ok: true, changed, status: next.status, amountPaidCents: next.amountPaidCents }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'reconcile failed'
    console.error('[invoicing] reconcileXeroPayment failed', invoiceId, err)
    await prisma.invoice
      .update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } })
      .catch(() => {})
    return { ok: false, error }
  }
}

/**
 * Reconcile every still-open (UNPAID/PARTIAL), Xero-synced invoice for one
 * trainer — oldest first, bounded. Returns a {checked, updated} summary.
 */
export async function reconcileTrainerXeroPayments(trainerId: string): Promise<{ checked: number; updated: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { trainerId, xeroInvoiceId: { not: null }, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true },
  })
  let updated = 0
  for (const inv of invoices) {
    const r = await reconcileXeroPayment(inv.id)
    if (r.ok && r.changed) updated++
  }
  return { checked: invoices.length, updated }
}

/**
 * Cron entry point: reconcile every still-open, Xero-synced invoice across all
 * trainers — oldest first, bounded. Returns a {checked, updated} summary.
 */
export async function reconcileAllXeroPayments(): Promise<{ checked: number; updated: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { xeroInvoiceId: { not: null }, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
    take: 2000,
    select: { id: true },
  })
  let updated = 0
  for (const inv of invoices) {
    const r = await reconcileXeroPayment(inv.id)
    if (r.ok && r.changed) updated++
  }
  return { checked: invoices.length, updated }
}

// ─── Outbound settlement (Stripe card payment → invoice PAID) ─────────────────

/**
 * Settle an invoice from a successful Stripe `Payment` (the public pay page).
 * Called by the Connect webhook AFTER the Payment is marked PAID. Adds the base
 * (non-surcharge) amount the client paid to `amountPaidCents`, recomputes the
 * status via applyPaidAmount, stamps paidAt, and links `Invoice.paymentId`.
 * Then records the payment against the Xero invoice (best-effort).
 *
 * Idempotent: a re-delivery (invoice already PAID by this payment) is a no-op.
 * Never throws — a failure here must not fail the webhook (→ Stripe retry loop).
 */
export async function settleInvoiceFromPayment(
  invoiceId: string,
  paymentId: string,
  /**
   * How much of this payment belongs to THIS invoice, in minor units. Omit for
   * the pay-page case, where the whole payment settles the one invoice it was
   * raised for. Class enrolments need it: a single card payment can cover
   * several enrolments (two dogs, four drop-in dates), each with its own
   * receivable, and crediting every one of them with the full payment would
   * report the same money several times over.
   */
  amountCents?: number,
): Promise<void> {
  try {
    const [invoice, payment] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true, amountCents: true, amountPaidCents: true, status: true, paidAt: true, paymentId: true,
          currency: true, description: true,
          trainer: { select: { userId: true } },
          client: { select: { user: { select: { name: true } } } },
        },
      }),
      prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, paidAt: true, items: { select: { unitAmount: true, quantity: true, intent: true } } },
      }),
    ])
    if (!invoice || !payment) return
    // Already fully settled — nothing to do (webhook retry / duplicate delivery).
    // Notifying below sits AFTER this guard, so a retry never re-notifies.
    if (invoice.status === 'PAID') return

    // The client paid the invoice balance PLUS an optional card surcharge line;
    // only the base (non-surcharge) lines count toward the invoice.
    const basePaid = amountCents ?? payment.items
      .filter((i) => !isSurchargeItem(i))
      .reduce((sum, i) => sum + i.unitAmount * i.quantity, 0)
    if (basePaid <= 0) return

    const next = applyPaidAmount({ amountCents: invoice.amountCents }, invoice.amountPaidCents + basePaid)
    const paidAt = next.status === 'PAID' ? invoice.paidAt ?? payment.paidAt ?? next.paidAt : invoice.paidAt

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaidCents: next.amountPaidCents, status: next.status, paidAt, paymentId },
    })

    // The invoice actually transitioned (PAID / PARTIAL, amountPaidCents up) —
    // notify the TRAINER that a payment landed. Best-effort; only reached on a
    // real settlement (past the already-PAID guard), so webhook retries — which
    // don't even re-enter here (didFulfil is false) — never double-notify. The
    // client is the payer and already knows, so they're never notified here.
    await notifyTrainerOfPayment({
      trainerUserId: invoice.trainer.userId,
      clientName: invoice.client?.user?.name ?? null,
      amountCents: basePaid,
      currency: invoice.currency,
      description: invoice.description,
    }).catch((e) => console.error('[invoicing] trainer payment notify failed', invoice.id, e))

    // Record the payment against the Xero invoice, through the Stripe clearing
    // account (best-effort).
    await syncReceivablePaymentToXero(invoice.id, paymentId)
      .catch((e) => console.error('[invoicing] xero payment push failed', invoice.id, e))
  } catch (err) {
    console.error('[invoicing] settleInvoiceFromPayment failed', invoiceId, paymentId, err)
  }
}

/**
 * Give a PAID class enrolment the same paper trail a pay-later one gets: a
 * receivable, then that receivable settled against the payment that already
 * cleared. Without it the roster reads "No invoice" on a seat the client has
 * paid for, and the trainer reconciles it against Stripe by hand.
 *
 * Lives here rather than inside the connect webhook so the fulfilment can be
 * exercised without a real Stripe round-trip (scripts/simulate-class-payment.ts
 * calls exactly this) — a test that reimplements the logic it's testing proves
 * nothing.
 *
 * Best-effort throughout: the client has paid and is enrolled, and no
 * bookkeeping hiccup may undo either by failing the webhook into a retry.
 */
export async function settleClassEnrolmentPayment(args: {
  trainerId: string
  clientId: string
  enrollmentId: string
  paymentItemId: string
  paymentId: string
}): Promise<string | null> {
  try {
    const invoiceId = await createInvoiceForAssignment({
      trainerId: args.trainerId,
      clientId: args.clientId,
      sourceType: 'CLASS_ENROLLMENT',
      classEnrollmentId: args.enrollmentId,
      // They paid at the checkout — a "you owe this" email now would be wrong.
      notifyClient: false,
    })
    if (!invoiceId) return null
    // Only the amount on THIS line settles this invoice: one card payment can
    // cover several enrolments (two dogs, four drop-in dates), each with its
    // own receivable, and crediting every one of them with the payment total
    // would report the same money several times over.
    const item = await prisma.paymentItem.findUnique({
      where: { id: args.paymentItemId },
      select: { unitAmount: true, quantity: true },
    })
    const paidForThisLine = item ? item.unitAmount * item.quantity : undefined
    await settleInvoiceFromPayment(invoiceId, args.paymentId, paidForThisLine)
    return invoiceId
  } catch (err) {
    console.error('[invoicing] paid class enrolment invoice failed', args.enrollmentId, err)
    return null
  }
}

/**
 * Notify a trainer (in-app + push) that a client paid an invoice. Trainer-only —
 * the payer already knows. Mirrors notifyClientOfInvoice's shape, aimed at the
 * trainer's user. Best-effort; each side is independently swallowed.
 */
async function notifyTrainerOfPayment(args: {
  trainerUserId: string
  clientName: string | null
  amountCents: number
  currency: string
  description: string | null
}): Promise<void> {
  const amountStr = money(args.amountCents, args.currency)
  const who = args.clientName?.trim() || 'A client'
  const title = `Payment received: ${amountStr}`
  const body = `${who} paid ${amountStr}${args.description ? ` for ${args.description}` : ''}.`
  const link = `${env.NEXT_PUBLIC_APP_URL}/finances`

  await prisma.notification.create({ data: { userId: args.trainerUserId, title, body, link } }).catch(() => {})
  await sendPush(args.trainerUserId, { alert: { title, body }, customData: { path: link } }).catch(() => {})
}

/**
 * Record a settled card payment against the receivable's Xero invoice, through
 * the trainer's STRIPE CLEARING account (see xero-clearing.ts).
 *
 * This used to post the invoice amount straight into the trainer's BANK account,
 * which only ever matched the bank feed by luck: Stripe deducts its processing
 * fee AND our application fee before paying out, so when the trainer ABSORBED
 * the card fee the bank received $144.25 while Xero claimed $150.00 — wrong every
 * single time — and the two fees were never recorded as expenses at all.
 *
 * Now the payment settles the invoice against the clearing account and the fees
 * are expensed out of it, so Stripe's payout reconciles in the bank feed exactly.
 *
 * Lazily creates the Xero ACCREC invoice first if it wasn't synced. Best-effort —
 * never throws; records SYNCED / ERROR. No-op when the trainer isn't connected,
 * or (in prod) is a sandbox/demo trainer. Idempotent via the Payment's leg ids,
 * so a webhook re-delivery never double-posts.
 */
export async function syncReceivablePaymentToXero(invoiceId: string, paymentId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, clientId: true, xeroInvoiceId: true,
      trainer: { select: { sandboxBilling: true, xeroConnection: true } },
    },
  })
  if (!invoice) return
  if (invoice.trainer.sandboxBilling && process.env.NODE_ENV !== 'development') return // sandbox bypass
  const connection = invoice.trainer.xeroConnection
  if (!connection) return

  try {
    const contactId = await ensureClientXeroContact(invoice.clientId)
    if (!contactId) throw new Error('Could not resolve the client’s Xero contact.')

    // Ensure the ACCREC invoice exists in Xero before applying a payment to it.
    let xeroInvoiceId = invoice.xeroInvoiceId
    if (!xeroInvoiceId) {
      const r = await syncReceivableToXero(invoiceId)
      if (!r.ok || !r.xeroInvoiceId) return
      xeroInvoiceId = r.xeroInvoiceId
    }

    // Anchor the Payment to the same Xero invoice, so its clearing legs (and
    // their idempotency ids) all hang off one row regardless of which path ran.
    await prisma.payment.update({ where: { id: paymentId }, data: { xeroInvoiceId } }).catch(() => {})

    const posted = await postPaymentThroughClearing({
      connection,
      paymentId,
      xeroInvoiceId,
      clientContactId: contactId,
    })
    if (posted.pending) {
      // Stripe's fee isn't known yet — nothing has been posted. Leave the
      // invoice unsynced; the charge.updated webhook retries once it lands.
      console.info('[invoicing] xero payment sync deferred — awaiting Stripe fee', invoiceId)
      return
    }

    await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'SYNCED', xeroSyncError: null } }).catch(() => {})
    await prisma.payment.update({ where: { id: paymentId }, data: { xeroSyncStatus: 'SYNCED', xeroSyncError: null } }).catch(() => {})
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Xero payment push failed'
    console.error('[invoicing] syncReceivablePaymentToXero failed', invoiceId, err)
    await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } }).catch(() => {})
    await prisma.payment.update({ where: { id: paymentId }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } }).catch(() => {})
  }
}

/**
 * Mark an unsent receivable as sent and notify the client. Used by the Finances
 * "Send" action. Idempotent-ish: re-sending an already-sent invoice just
 * re-notifies (Phase 2 will add throttling). Returns false if not found /
 * not the trainer's / already cancelled.
 */
export async function sendReceivable(invoiceId: string, trainerId: string): Promise<boolean> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, trainerId },
    select: {
      id: true, clientId: true, description: true, amountCents: true, currency: true, status: true, payToken: true,
      trainer: { select: { businessName: true } },
    },
  })
  if (!invoice || invoice.status === 'CANCELLED') return false

  await prisma.invoice.update({ where: { id: invoice.id }, data: { sentAt: new Date() } })
  await notifyClientOfInvoice({
    trainerId,
    clientId: invoice.clientId,
    businessName: invoice.trainer.businessName ?? 'Your trainer',
    description: invoice.description ?? 'Invoice',
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    payToken: invoice.payToken,
  }).catch((e) => console.error('[invoicing] sendReceivable notify failed', invoice.id, e))
  return true
}

function invoiceEmail(
  business: string,
  description: string,
  amount: string,
  payLink: string | null,
  fee: string | null,
  cardTotal: string | null,
): string {
  // The button quotes what the card is actually charged, so the amount here, on
  // the pay page and on Stripe's page are all the same number.
  const payLabel = cardTotal ? `Pay ${cardTotal}` : 'Pay now'
  const feeNote = fee && cardTotal
    ? `<p style="margin:10px 0 0;font-size:12px;color:#94a3b8">Includes a ${fee} card processing fee.</p>`
    : ''
  const cta = payLink
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0"><tr><td>
        <a href="${payLink}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px">${payLabel}</a>
      </td></tr></table>
      ${feeNote}
      <p style="margin:14px 0 0;font-size:12px;color:#94a3b8">Secure card payment — no account needed.</p>`
    : `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${business} will let you know how to pay. Please get in touch if you have any questions.</p>`
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(15,31,36,0.06)">
      <tr><td style="height:4px;background:${ACCENT}"></td></tr>
      <tr><td style="padding:22px 24px 24px">
        <p style="margin:0 0 14px;font-weight:700;color:${ACCENT};font-size:15px">${business}</p>
        <h1 style="margin:0 0 8px;font-size:19px;line-height:1.3;color:#0f172a">You have a new invoice</h1>
        <p style="margin:0 0 4px;font-size:14px;color:#475569">${description}</p>
        <p style="margin:0 0 18px;font-size:24px;font-weight:700;color:#0f172a">${amount}</p>
        ${cta}
      </td></tr>
    </table>
  </td></tr></table></body></html>`
}
