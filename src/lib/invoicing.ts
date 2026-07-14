import { after } from 'next/server'
import { prisma } from './prisma'
import { sendEmail } from './email'
import { sendPush } from './push'
import { estimateProcessingSurcharge } from './connect'
import { ensureClientXeroContact } from './xero-sync'
import { createXeroInvoice, fetchXeroInvoiceState, createXeroPayment } from './xero'
import { dropInPriceCents } from './class-runs'
import { env } from './env'

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
  return `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`
}

export interface AssignmentInvoiceInput {
  trainerId: string
  clientId: string
  sourceType: 'PACKAGE' | 'PRODUCT' | 'CLASS_ENROLLMENT'
  // Exactly one of these, matching sourceType. Also the idempotency sourceId.
  clientPackageId?: string
  productId?: string
  classEnrollmentId?: string
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
      // is the package (special) price; a DROP_IN pays per remaining session from
      // where it joined.
      const enr = await prisma.classEnrollment.findFirst({
        where: { id: sourceId, clientId: input.clientId },
        select: {
          type: true, joinedAtIndex: true,
          classRun: {
            select: {
              name: true,
              package: { select: { priceCents: true, specialPriceCents: true, dropInPriceCents: true, sessionCount: true } },
            },
          },
        },
      })
      if (!enr) return null
      const pkg = enr.classRun.package
      amountCents = enr.type === 'DROP_IN'
        ? dropInPriceCents({ dropInPriceCents: pkg.dropInPriceCents, sessionCount: pkg.sessionCount, joinedAtIndex: enr.joinedAtIndex ?? 1 })
        : (pkg.specialPriceCents ?? pkg.priceCents)
      description = enr.classRun.name
    } else {
      const product = await prisma.product.findFirst({
        where: { id: sourceId, trainerId: input.trainerId },
        select: { name: true, priceCents: true },
      })
      if (!product) return null
      amountCents = product.priceCents
      description = product.name
    }

    // Skip free / unpriced items — nothing to invoice.
    if (!amountCents || amountCents <= 0) return null

    // Idempotency: at most one invoice per (trainer, client, source). A repeat
    // assignment of the same source is a no-op (returns the existing id) and
    // never re-sends.
    const existing = await prisma.invoice.findFirst({
      where: { trainerId: input.trainerId, clientId: input.clientId, sourceType: input.sourceType, sourceId },
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

    const invoice = await prisma.invoice.create({
      data: {
        trainerId: input.trainerId,
        clientId: input.clientId,
        amountCents,
        currency,
        status: 'UNPAID',
        description,
        sourceType: input.sourceType,
        sourceId,
        sentAt: autoSend ? new Date() : null,
        // Every invoice has >=1 line. Assignment invoices start with a single
        // line for the package/product; the trainer can add more in the editor.
        lines: {
          create: [{ description, quantity: 1, unitAmountCents: amountCents, amountCents, sortOrder: 0 }],
        },
      },
      select: { id: true, payToken: true },
    })

    // Side effects (client email + Xero push) run AFTER the response so the
    // booking/assignment that triggered this never blocks on Resend/Xero network
    // round-trips (which made self-book feel slow). The invoice row itself is
    // already committed above; these are best-effort and never affect it.
    const xeroEnabled = !!trainer.xeroConnection && (!trainer.sandboxBilling || process.env.NODE_ENV === 'development')
    after(() => {
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
        select: { classRun: { select: { package: { select: { xeroAccountCode: true } } } } },
      })
      sourceCode = enr?.classRun?.package?.xeroAccountCode ?? null
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
export async function settleInvoiceFromPayment(invoiceId: string, paymentId: string): Promise<void> {
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
    const basePaid = payment.items
      .filter((i) => !(i.intent && typeof i.intent === 'object' && (i.intent as Record<string, unknown>).surcharge === true))
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

    // Record the payment against the Xero invoice (best-effort).
    await syncReceivablePaymentToXero(invoice.id, basePaid, payment.paidAt ?? new Date())
      .catch((e) => console.error('[invoicing] xero payment push failed', invoice.id, e))
  } catch (err) {
    console.error('[invoicing] settleInvoiceFromPayment failed', invoiceId, paymentId, err)
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
 * Record a settled card payment against the invoice's Xero invoice (marking it
 * paid in Xero). Lazily creates the Xero ACCREC invoice first if it wasn't
 * synced. Best-effort — never throws; records SYNCED / ERROR. No-op when the
 * trainer isn't connected, or (in prod) is a sandbox/demo trainer.
 */
export async function syncReceivablePaymentToXero(invoiceId: string, amountMinor: number, date: Date): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, xeroInvoiceId: true, trainer: { select: { sandboxBilling: true, xeroConnection: true } } },
  })
  if (!invoice) return
  if (invoice.trainer.sandboxBilling && process.env.NODE_ENV !== 'development') return // sandbox bypass
  const connection = invoice.trainer.xeroConnection
  if (!connection) return
  if (amountMinor <= 0) return

  try {
    // Ensure the ACCREC invoice exists in Xero before applying a payment to it.
    let xeroInvoiceId = invoice.xeroInvoiceId
    if (!xeroInvoiceId) {
      const r = await syncReceivableToXero(invoiceId)
      if (!r.ok || !r.xeroInvoiceId) return
      xeroInvoiceId = r.xeroInvoiceId
    }
    if (!connection.bankAccountCode) {
      throw new Error('No Xero bank account is set. Choose one in Settings → Integrations.')
    }
    await createXeroPayment(connection, {
      invoiceId: xeroInvoiceId,
      accountCode: connection.bankAccountCode,
      amountMinor,
      date,
      reference: invoice.id,
    })
    await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'SYNCED', xeroSyncError: null } }).catch(() => {})
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Xero payment push failed'
    console.error('[invoicing] syncReceivablePaymentToXero failed', invoiceId, err)
    await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } }).catch(() => {})
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
