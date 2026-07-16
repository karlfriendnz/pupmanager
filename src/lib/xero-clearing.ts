import type { XeroConnection } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { createXeroPayment, createXeroBankTransaction, ensureXeroContactByName } from '@/lib/xero'

// ─── The Stripe clearing-account model ────────────────────────────────────────
//
// Client→trainer payments are Stripe DIRECT charges: the trainer is merchant of
// record, and Stripe deducts BOTH its processing fee AND our application fee
// before a cent reaches their bank. So the money that lands in the bank is never
// the invoice amount, and posting the payment straight to the bank account (what
// we used to do) guarantees the trainer's Xero can NEVER reconcile against their
// bank feed.
//
// The fix is the standard Stripe-in-Xero clearing model. For a $150 package with
// the card fee passed to the client (client's card charged $155.75):
//
//   ACCREC invoice          $150.00   income  (what they actually sold)
//   Payment on that invoice $150.00   → Stripe Clearing   (NOT the bank)
//   RECEIVE on clearing       $5.75   income  (the card surcharge the client paid —
//                                              they received it, so it IS income)
//   SPEND   on clearing      -$4.43   expense (Stripe's processing fee)
//   SPEND   on clearing      -$1.32   expense (PupManager's application fee)
//   ─────────────────────────────────
//   clearing balance        $150.00   ← exactly what Stripe pays out
//
// Stripe's payout then shows up in the bank feed and reconciles as a transfer
// from clearing → bank. Every line matches to the cent, and both fees are now
// recorded as deductible expenses (previously they were never recorded at all).
//
// SURCHARGE PLACEMENT — the deliberate choice: the card surcharge is kept OFF
// the ACCREC invoice and booked as a RECEIVE straight into the clearing account.
// It's still recognised as income, coded to a configurable revenue account. The
// alternative (a surcharge line ON the invoice) would mean the trainer-raised
// invoice path had to EDIT an already-AUTHORISED Xero invoice at settlement time
// — which Xero forbids once a payment is applied, and which would fork the two
// paths' logic. Keeping it out means the invoice always states what was sold,
// both paths run the exact same code, and nothing is ever mutated after the fact.

/** Every Xero account the clearing model needs, resolved and validated. */
export type ClearingAccounts = {
  clearingAccountCode: string
  feeAccountCode: string
  surchargeAccountCode: string
}

/**
 * Resolve the clearing/fee/surcharge accounts for a connection, or throw a
 * plain-language, actionable error (surfaced on the payment as xeroSyncError and
 * retriable once the trainer fixes the mapping) — never post to the wrong place.
 */
export function requireClearingAccounts(connection: XeroConnection): ClearingAccounts {
  if (!connection.clearingAccountCode) {
    throw new Error(
      'No Stripe clearing account is set. Stripe takes its fee before paying you, so card payments can’t post straight to your bank — choose a clearing account in Settings → Integrations.',
    )
  }
  if (!connection.feeAccountCode) {
    throw new Error(
      'No Xero expense account is set for payment fees. Choose one in Settings → Integrations so Stripe’s fee and PupManager’s fee can be recorded.',
    )
  }
  // Same account for both would put the gross in the bank and take the fees back
  // out of it — i.e. exactly the broken posting the clearing account exists to
  // prevent. Refuse rather than post something that won't reconcile.
  if (connection.bankAccountCode && connection.bankAccountCode === connection.clearingAccountCode) {
    throw new Error(
      'Your Stripe clearing account and your bank account are the same. Pick a separate clearing account in Settings → Integrations.',
    )
  }
  return {
    clearingAccountCode: connection.clearingAccountCode,
    feeAccountCode: connection.feeAccountCode,
    // A dedicated surcharge income account is optional — fall back to the
    // default sales account so an unset picker never blocks the sync.
    surchargeAccountCode: connection.surchargeAccountCode || connection.salesAccountCode || '',
  }
}

export type PaymentItemLike = { unitAmount: number; quantity: number; intent?: unknown }

/** True for the synthetic "Card processing fee" line createPaymentRecord appends. */
export function isSurchargeItem(item: PaymentItemLike): boolean {
  const intent = item.intent
  return !!intent && typeof intent === 'object' && (intent as Record<string, unknown>).surcharge === true
}

/** Total (minor units) of the client-paid card surcharge lines. 0 when the trainer absorbs the fee. */
export function surchargeMinor(items: PaymentItemLike[]): number {
  return items.filter(isSurchargeItem).reduce((sum, i) => sum + i.unitAmount * i.quantity, 0)
}

/** Total (minor units) of everything that is NOT the surcharge — i.e. the invoice total. */
export function invoiceMinor(items: PaymentItemLike[]): number {
  return items.filter((i) => !isSurchargeItem(i)).reduce((sum, i) => sum + i.unitAmount * i.quantity, 0)
}

export type PaymentLike = {
  amountTotal: number
  applicationFeeAmount: number
  stripeFeeAmount: number | null
  items: PaymentItemLike[]
}

export type ClearingBreakdown = {
  /** What the client's card was actually charged. */
  grossMinor: number
  /** The ACCREC invoice total — gross minus any card surcharge. */
  invoiceMinor: number
  /** Card surcharge the client paid on top (income). 0 when the trainer absorbs it. */
  surchargeMinor: number
  /** Stripe's processing fee. */
  stripeFeeMinor: number
  /** PupManager's application fee. */
  platformFeeMinor: number
  /** What Stripe actually pays into the bank: gross − both fees. The invariant. */
  netToBankMinor: number
}

/**
 * The full money breakdown for one payment. THE INVARIANT this whole model
 * exists to hold:
 *
 *   invoice + surcharge (into clearing) − stripeFee − platformFee (out of it)
 *     === netToBank === what the trainer's bank feed will show.
 *
 * Throws when Stripe's fee isn't known yet — we NEVER guess a fee number and
 * post it into someone's books (see postPaymentThroughClearing).
 */
export function clearingBreakdown(payment: PaymentLike): ClearingBreakdown {
  if (payment.stripeFeeAmount == null) {
    throw new Error('Stripe’s processing fee for this payment isn’t known yet.')
  }
  const gross = payment.amountTotal
  const surcharge = surchargeMinor(payment.items)
  const stripeFee = payment.stripeFeeAmount
  const platformFee = payment.applicationFeeAmount
  return {
    grossMinor: gross,
    invoiceMinor: gross - surcharge,
    surchargeMinor: surcharge,
    stripeFeeMinor: stripeFee,
    platformFeeMinor: platformFee,
    netToBankMinor: gross - stripeFee - platformFee,
  }
}

export type ClearingPostResult = {
  ok: boolean
  /** True when we're simply waiting on Stripe's fee — retriable, NOT an error. */
  pending?: boolean
  xeroPaymentId?: string
  error?: string
}

/**
 * Post a settled card payment through the trainer's Stripe clearing account:
 * the payment against the ACCREC invoice, the surcharge RECEIVE (if any), and
 * the two fee SPENDs. Each leg's id is persisted the moment it's created, so a
 * webhook re-delivery — or a retry after a partial failure — resumes exactly
 * where it left off and never double-posts.
 *
 * Throws on a real failure (the caller records ERROR). Returns { pending: true }
 * — writing nothing at all — when Stripe hasn't reported its fee yet; the
 * charge.updated webhook re-runs the sync once it has.
 */
export async function postPaymentThroughClearing(args: {
  connection: XeroConnection
  paymentId: string
  xeroInvoiceId: string
  /** The Xero contact the invoice is against — the surcharge income is booked to them too. */
  clientContactId: string
}): Promise<ClearingPostResult> {
  const { connection, paymentId, xeroInvoiceId, clientContactId } = args

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amountTotal: true, applicationFeeAmount: true, stripeFeeAmount: true, paidAt: true,
      xeroPaymentId: true, xeroSurchargeTxnId: true, xeroFeeTxnId: true, xeroPlatformFeeTxnId: true,
      items: { select: { unitAmount: true, quantity: true, intent: true } },
    },
  })
  if (!payment) throw new Error('payment not found')

  // Stripe's fee lands on the Payment asynchronously (charge.updated, once the
  // balance transaction settles — usually seconds after fulfilment). Until it
  // does we post NOTHING: a guessed fee is a wrong number in a real ledger, and
  // a payment posted without its fees leaves the clearing account permanently
  // out of balance. Wait and retry instead.
  if (payment.stripeFeeAmount == null) {
    return {
      ok: false,
      pending: true,
      error: 'Waiting for Stripe to confirm its processing fee — this payment will sync automatically once it does.',
    }
  }

  const accounts = requireClearingAccounts(connection)
  const b = clearingBreakdown(payment)
  const date = payment.paidAt ?? new Date()

  // 1. The client's payment → the CLEARING account (not the bank). This settles
  //    the ACCREC invoice in Xero.
  let xeroPaymentId = payment.xeroPaymentId
  if (!xeroPaymentId && b.invoiceMinor > 0) {
    xeroPaymentId = await createXeroPayment(connection, {
      invoiceId: xeroInvoiceId,
      accountCode: accounts.clearingAccountCode,
      amountMinor: b.invoiceMinor,
      date,
      reference: payment.id,
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { xeroPaymentId } })
  }

  // 2. The card surcharge the client paid on top — income, RECEIVEd into
  //    clearing so the clearing balance equals the gross that Stripe actually
  //    holds. Skipped entirely when the trainer absorbs the fee.
  if (b.surchargeMinor > 0 && !payment.xeroSurchargeTxnId) {
    if (!accounts.surchargeAccountCode) {
      throw new Error(
        'No income account is mapped for the card surcharge your client paid. Set a default income account in Settings → Integrations.',
      )
    }
    const id = await createXeroBankTransaction(connection, {
      type: 'RECEIVE',
      contactId: clientContactId,
      bankAccountCode: accounts.clearingAccountCode,
      accountCode: accounts.surchargeAccountCode,
      description: 'Card processing fee recovered from client',
      amountMinor: b.surchargeMinor,
      date,
      reference: payment.id,
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { xeroSurchargeTxnId: id } })
  }

  // 3. Stripe's processing fee — SPENT out of clearing. Now a real, deductible
  //    expense in the trainer's books (it never used to be recorded at all).
  if (b.stripeFeeMinor > 0 && !payment.xeroFeeTxnId) {
    const stripeContactId = await ensureXeroContactByName(connection, 'Stripe')
    const id = await createXeroBankTransaction(connection, {
      type: 'SPEND',
      contactId: stripeContactId,
      bankAccountCode: accounts.clearingAccountCode,
      accountCode: accounts.feeAccountCode,
      description: 'Stripe card processing fee',
      amountMinor: b.stripeFeeMinor,
      date,
      reference: payment.id,
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { xeroFeeTxnId: id } })
  }

  // 4. PupManager's application fee — SPENT out of clearing. Same deal.
  if (b.platformFeeMinor > 0 && !payment.xeroPlatformFeeTxnId) {
    const platformContactId = await ensureXeroContactByName(connection, 'PupManager')
    const id = await createXeroBankTransaction(connection, {
      type: 'SPEND',
      contactId: platformContactId,
      bankAccountCode: accounts.clearingAccountCode,
      accountCode: accounts.feeAccountCode,
      description: 'PupManager payment fee',
      amountMinor: b.platformFeeMinor,
      date,
      reference: payment.id,
    })
    await prisma.payment.update({ where: { id: payment.id }, data: { xeroPlatformFeeTxnId: id } })
  }

  return { ok: true, xeroPaymentId: xeroPaymentId ?? undefined }
}
