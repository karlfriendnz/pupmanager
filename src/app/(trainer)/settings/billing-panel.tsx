import { prisma } from '@/lib/prisma'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { formatDate } from '@/lib/utils'
import type Stripe from 'stripe'

// Trainer-facing billing history for their PupManager subscription. Shows
// the current subscription summary plus past invoices pulled live from
// Stripe (read-only — managing the plan happens via /billing/setup or the
// Stripe-hosted invoice pages linked here). Owner-only; rendered as a tab
// on Settings.
export async function BillingPanel({ companyId }: { companyId: string }) {
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: companyId },
    select: {
      stripeCustomerId: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      seatCount: true,
      subscriptionPlan: { select: { name: true } },
    },
  })

  let invoices: Stripe.Invoice[] = []
  if (isStripeConfigured() && profile?.stripeCustomerId) {
    try {
      const list = await stripe().invoices.list({ customer: profile.stripeCustomerId, limit: 24 })
      invoices = list.data
    } catch {
      invoices = []
    }
  }

  const planName = profile?.subscriptionPlan?.name ?? 'Core software'

  return (
    <div className="flex flex-col gap-6">
      {/* Subscription summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your subscription</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-lg font-semibold text-slate-900">{planName}</p>
            <p className="text-sm text-slate-500">{profile?.seatCount ?? 1} trainer{(profile?.seatCount ?? 1) === 1 ? '' : 's'}</p>
          </div>
          <StatusBadge status={profile?.subscriptionStatus ?? 'INACTIVE'} />
          {profile?.currentPeriodEnd && (
            <p className="text-sm text-slate-500">
              {profile.subscriptionStatus === 'CANCELLED' ? 'Access until ' : 'Renews '}
              {formatDate(profile.currentPeriodEnd)}
            </p>
          )}
        </div>
        <a
          href="/billing/setup"
          className="mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: 'var(--pm-brand-600)' }}
        >
          Manage subscription
        </a>
      </div>

      {/* Invoices */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Invoices</p>

        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">
            No invoices yet. Once your first payment is taken, your receipts will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Invoice</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-t border-slate-100">
                    <td className="py-2.5 pr-4 text-slate-700 whitespace-nowrap">
                      {formatDate(new Date(inv.created * 1000))}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 tabular-nums">{inv.number ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-slate-900 tabular-nums whitespace-nowrap">
                      {formatMoney(inv.total, inv.currency)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <InvoiceStatus status={inv.status} />
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      {inv.invoice_pdf && (
                        <a
                          href={inv.invoice_pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium hover:underline"
                          style={{ color: 'var(--pm-brand-700)' }}
                        >
                          Download
                        </a>
                      )}
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-3 text-sm text-slate-500 hover:underline"
                        >
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function formatMoney(amountMinor: number, currency: string): string {
  // All our currencies are 2-decimal minor units.
  const value = (amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${currency.toUpperCase()} ${value}`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    TRIALING: 'bg-blue-100 text-blue-700',
    PAST_DUE: 'bg-rose-100 text-rose-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
    INACTIVE: 'bg-slate-100 text-slate-500',
  }
  const label: Record<string, string> = {
    ACTIVE: 'Active', TRIALING: 'Trial', PAST_DUE: 'Payment due', CANCELLED: 'Cancelled', INACTIVE: 'No plan',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  )
}

function InvoiceStatus({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    open: 'bg-amber-100 text-amber-700',
    draft: 'bg-slate-100 text-slate-500',
    void: 'bg-slate-100 text-slate-400',
    uncollectible: 'bg-rose-100 text-rose-700',
  }
  const s = status ?? 'draft'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[s] ?? map.draft}`}>
      {s}
    </span>
  )
}
