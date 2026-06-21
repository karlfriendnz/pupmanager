import { prisma } from './prisma'
import { sendEmail } from './email'
import { sendPush } from './push'
import { createPaymentRecord, type CheckoutLine } from './connect-checkout'
import { env } from './env'

// Trainer-issued invoice: a PENDING Payment tied to an existing package
// assignment or a product, plus a stable pay link sent to the client by in-app
// notification, push, and email. The client opens /my/pay/<id>, which mints the
// Stripe Checkout Session on demand (raw Checkout URLs expire in ~24h, so we
// never email those directly). On payment the connect webhook marks it paid and
// stamps the linked ClientPackage / fulfils the product.

const ACCENT = '#0d9488'

export interface CreateInvoiceInput {
  trainerId: string
  connectAccountId: string
  sandbox: boolean
  clientId: string
  clientUserId: string | null
  clientEmail: string | null
  currency: string
  businessName: string
  kind: 'PACKAGE' | 'PRODUCT'
  clientPackageId?: string
  productId?: string
  amount: number // minor units
  description: string // e.g. "6-Week Puppy Course"
}

function money(minor: number, currency: string): string {
  return `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`
}

/** Create a PENDING invoice Payment and notify the client. Returns the id. */
export async function createAndSendInvoice(input: CreateInvoiceInput): Promise<string> {
  const line: CheckoutLine =
    input.kind === 'PACKAGE'
      ? { kind: 'PACKAGE', description: input.description, unitAmount: input.amount, quantity: 1, clientPackageId: input.clientPackageId, intent: { invoice: true } }
      : { kind: 'PRODUCT', description: input.description, unitAmount: input.amount, quantity: 1, productId: input.productId, intent: { invoice: true } }

  const paymentId = await createPaymentRecord({
    sandbox: input.sandbox,
    trainerId: input.trainerId,
    connectAccountId: input.connectAccountId,
    clientId: input.clientId,
    currency: input.currency,
    description: input.description,
    lines: [line],
  })

  await sendInvoiceNotification({
    paymentId,
    clientUserId: input.clientUserId,
    clientEmail: input.clientEmail,
    businessName: input.businessName,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
  })

  return paymentId
}

// Notify (or re-notify) the client about an invoice: in-app notification, push,
// and a branded email with the pay link. Used at creation and by the "resend"
// action. Payment requests aren't user-suppressible, so we send directly rather
// than through the preference-gated notification types.
export async function sendInvoiceNotification(args: {
  paymentId: string
  clientUserId: string | null
  clientEmail: string | null
  businessName: string
  description: string
  amount: number
  currency: string
}): Promise<void> {
  const link = `${env.NEXT_PUBLIC_APP_URL}/my/pay/${args.paymentId}`
  const amountStr = money(args.amount, args.currency)
  const title = `Payment requested: ${amountStr}`
  const body = `${args.businessName} has requested ${amountStr} for ${args.description}.`

  if (args.clientUserId) {
    await prisma.notification.create({ data: { userId: args.clientUserId, title, body, link } }).catch(() => {})
    await sendPush(args.clientUserId, { alert: { title, body }, customData: { path: link } }).catch(() => {})
  }
  if (args.clientEmail) {
    await sendEmail({
      to: args.clientEmail,
      subject: `${args.businessName}: payment requested`,
      html: invoiceEmail(args.businessName, args.description, amountStr, link),
      text: `${body}\n\nPay securely: ${link}`,
    }).catch(() => {})
  }
}

function invoiceEmail(business: string, description: string, amount: string, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(15,31,36,0.06)">
      <tr><td style="height:4px;background:${ACCENT}"></td></tr>
      <tr><td style="padding:22px 24px 24px">
        <p style="margin:0 0 14px;font-weight:700;color:${ACCENT};font-size:15px">${business}</p>
        <h1 style="margin:0 0 8px;font-size:19px;line-height:1.3;color:#0f172a">Payment requested</h1>
        <p style="margin:0 0 4px;font-size:14px;color:#475569">${description}</p>
        <p style="margin:0 0 18px;font-size:24px;font-weight:700;color:#0f172a">${amount}</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td>
          <a href="${link}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">Pay now</a>
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Secure checkout via Stripe. You'll get a receipt by email.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`
}
