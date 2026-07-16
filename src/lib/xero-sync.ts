import { prisma } from '@/lib/prisma'
import { ensureXeroContact, createXeroInvoice } from '@/lib/xero'
import { postPaymentThroughClearing, isSurchargeItem } from '@/lib/xero-clearing'

// Higher-level Xero sync orchestrators that load app data, call the low-level
// client in @/lib/xero, and persist the resulting Xero ids back. Phase 3's
// invoice push builds on ensureClientXeroContact to attach invoices to a contact.

/**
 * Ensure the client has a matching Xero Contact in their trainer's org and
 * return its ContactID. The id is persisted on the ClientProfile on first sync,
 * so subsequent calls are a no-op lookup.
 *
 * Returns null when there's nothing to do (client gone, or the trainer hasn't
 * connected Xero). Throws if the Xero API call itself fails, so the caller can
 * decide whether to surface or swallow.
 */
export async function ensureClientXeroContact(clientId: string): Promise<string | null> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      xeroContactId: true,
      phone: true,
      user: { select: { name: true, email: true } },
      trainer: { select: { xeroConnection: true } },
    },
  })
  if (!client) return null
  if (client.xeroContactId) return client.xeroContactId

  const connection = client.trainer.xeroConnection
  if (!connection) return null

  const name = client.user.name?.trim() || client.user.email || 'Client'
  const contactId = await ensureXeroContact(connection, {
    name,
    email: client.user.email,
    phone: client.phone,
  })

  await prisma.clientProfile.update({
    where: { id: client.id },
    data: { xeroContactId: contactId },
  })
  return contactId
}

export type InvoiceSyncResult = { ok: boolean; invoiceId?: string; error?: string }

/**
 * Mirror a Payment's invoice into the trainer's Xero org as an AUTHORISED ACCREC
 * invoice, attaching each line to its mapped revenue account (per-product/package
 * code → connection default sales account). Idempotent — a Payment that already
 * has a xeroInvoiceId is returned as-is.
 *
 * Best-effort: never throws. Records SYNCED / ERROR (+ message) on the Payment so
 * failures are retriable and surfaceable. A no-op (leaves NOT_SYNCED) when the
 * trainer isn't connected.
 */
export async function syncInvoiceToXero(paymentId: string): Promise<InvoiceSyncResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      clientId: true,
      sandbox: true,
      xeroInvoiceId: true,
      items: {
        select: {
          description: true, unitAmount: true, quantity: true, intent: true,
          productId: true, clientPackageId: true,
        },
      },
      trainer: { select: { xeroConnection: true } },
    },
  })
  if (!payment) return { ok: false, error: 'payment not found' }
  // Never sync demo/sandbox money into a trainer's real Xero books.
  if (payment.sandbox) return { ok: false, error: 'sandbox' }
  if (payment.xeroInvoiceId) return { ok: true, invoiceId: payment.xeroInvoiceId }

  const connection = payment.trainer.xeroConnection
  if (!connection) return { ok: false, error: 'not connected' } // leave NOT_SYNCED

  try {
    if (!payment.clientId) throw new Error('This invoice has no client to attach in Xero.')
    const contactId = await ensureClientXeroContact(payment.clientId)
    if (!contactId) throw new Error('Could not resolve the client’s Xero contact.')

    // The invoice states what was SOLD. The client-paid card surcharge is not
    // part of that — it's booked as income straight into the Stripe clearing
    // account at settlement (see xero-clearing.ts), which is also what keeps the
    // invoice total equal to the payment we apply against it. Including it here
    // (as we used to) told Xero the trainer had sold $155.75 of training and
    // banked all of it, when $5.75 was a fee recovery and Stripe kept $5.75.
    const saleItems = payment.items.filter((i) => !isSurchargeItem(i))
    if (!saleItems.length) throw new Error('This payment has nothing to invoice.')

    // Resolve each line's revenue account: the product/package's own code, else
    // the connection's default sales account.
    const productIds = saleItems.map((i) => i.productId).filter((v): v is string => !!v)
    const packageAssignmentIds = saleItems.map((i) => i.clientPackageId).filter((v): v is string => !!v)
    const [products, clientPackages] = await Promise.all([
      productIds.length
        ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, xeroAccountCode: true } })
        : Promise.resolve([]),
      packageAssignmentIds.length
        ? prisma.clientPackage.findMany({ where: { id: { in: packageAssignmentIds } }, select: { id: true, package: { select: { xeroAccountCode: true } } } })
        : Promise.resolve([]),
    ])
    const productCode = new Map(products.map((p) => [p.id, p.xeroAccountCode]))
    const packageCode = new Map(clientPackages.map((cp) => [cp.id, cp.package?.xeroAccountCode ?? null]))
    const fallback = connection.salesAccountCode

    const lines = saleItems.map((item) => {
      const code =
        (item.productId && productCode.get(item.productId)) ||
        (item.clientPackageId && packageCode.get(item.clientPackageId)) ||
        fallback
      if (!code) {
        throw new Error('No Xero income account is mapped. Set a default income account in Settings → Integrations.')
      }
      return {
        description: item.description,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmount,
        accountCode: code,
        taxType: connection.taxType,
      }
    })

    const invoiceId = await createXeroInvoice(connection, {
      contactId,
      reference: payment.id,
      hasTax: !!connection.taxType,
      lines,
    })

    await prisma.payment.update({
      where: { id: payment.id },
      data: { xeroInvoiceId: invoiceId, xeroSyncStatus: 'SYNCED', xeroSyncError: null },
    })
    return { ok: true, invoiceId }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Xero sync failed'
    console.error('[xero] syncInvoiceToXero failed', paymentId, err)
    await prisma.payment
      .update({ where: { id: payment.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } })
      .catch(() => {})
    return { ok: false, error }
  }
}

export type PaymentSyncResult = { ok: boolean; xeroPaymentId?: string; pending?: boolean; error?: string }

/**
 * Reconcile a settled Payment into Xero through the trainer's STRIPE CLEARING
 * account (see xero-clearing.ts for the model and a worked example): the payment
 * settles the ACCREC invoice against clearing — NOT the bank — and Stripe's fee,
 * our fee, and any client-paid surcharge are posted against clearing too, so the
 * balance left there is exactly what Stripe pays into the bank.
 *
 * Ensures the invoice exists first — this is where checkout-initiated payments
 * that skipped the trainer-invoice path get their invoice created lazily (so
 * abandoned checkouts, which never reach PAID, never hit Xero).
 *
 * Idempotent (each posted leg's Xero id is the guard, so a webhook re-delivery
 * re-posts nothing) and best-effort (never throws; records SYNCED / ERROR). A
 * no-op when the trainer isn't connected. Leaves the payment UNSYNCED and
 * retriable — not ERRORed — while Stripe's fee is still unknown.
 */
export async function syncPaymentToXero(paymentId: string): Promise<PaymentSyncResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      clientId: true,
      sandbox: true,
      xeroInvoiceId: true,
      xeroPaymentId: true,
      xeroFeeTxnId: true,
      xeroPlatformFeeTxnId: true,
      trainer: { select: { xeroConnection: true } },
    },
  })
  if (!payment) return { ok: false, error: 'payment not found' }
  if (payment.sandbox) return { ok: false, error: 'sandbox' }
  // Fully reconciled already — the invoice payment AND both fee expenses exist.
  // (xeroPaymentId alone is no longer enough: a run that posted the payment then
  // failed on a fee must be able to resume and finish the clearing entries.)
  if (payment.xeroPaymentId && payment.xeroFeeTxnId && payment.xeroPlatformFeeTxnId) {
    return { ok: true, xeroPaymentId: payment.xeroPaymentId }
  }

  const connection = payment.trainer.xeroConnection
  if (!connection) return { ok: false, error: 'not connected' }

  try {
    if (!payment.clientId) throw new Error('This payment has no client to attach in Xero.')
    const contactId = await ensureClientXeroContact(payment.clientId)
    if (!contactId) throw new Error('Could not resolve the client’s Xero contact.')

    // Ensure the invoice exists (lazy-create for checkout-initiated payments).
    let invoiceId = payment.xeroInvoiceId
    if (!invoiceId) {
      const inv = await syncInvoiceToXero(paymentId)
      if (!inv.ok || !inv.invoiceId) return { ok: false, error: inv.error ?? 'invoice sync failed' }
      invoiceId = inv.invoiceId
    }

    const posted = await postPaymentThroughClearing({
      connection,
      paymentId: payment.id,
      xeroInvoiceId: invoiceId,
      clientContactId: contactId,
    })
    // Stripe hasn't reported its fee yet — post NOTHING rather than guess. The
    // charge.updated webhook re-runs this the moment the fee lands.
    if (posted.pending) return { ok: false, pending: true, error: posted.error }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { xeroSyncStatus: 'SYNCED', xeroSyncError: null },
    })
    return { ok: true, xeroPaymentId: posted.xeroPaymentId }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Xero payment sync failed'
    console.error('[xero] syncPaymentToXero failed', paymentId, err)
    await prisma.payment
      .update({ where: { id: payment.id }, data: { xeroSyncStatus: 'ERROR', xeroSyncError: error } })
      .catch(() => {})
    return { ok: false, error }
  }
}
