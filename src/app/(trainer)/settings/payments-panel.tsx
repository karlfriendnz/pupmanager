import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/utils'
import { isConnectConfigured } from '@/lib/connect'
import { ConnectButton, AcceptPaymentsToggle, RefundButton } from './payments-actions'

function money(minor: number, currency: string | null): string {
  const value = (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${(currency ?? '').toUpperCase()} ${value}`.trim()
}

// Trainer-facing setup for taking payments from their clients (Stripe Connect
// Express). Owner-only; rendered as a tab on Settings. Three states: not
// started, onboarding in progress, and active. Payouts/KYC self-service live in
// the Stripe Express dashboard we link out to — we don't reimplement them.
export async function PaymentsPanel({ companyId }: { companyId: string }) {
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: companyId },
    select: {
      connectAccountId: true,
      connectChargesEnabled: true,
      connectPayoutsEnabled: true,
      connectDetailsSubmitted: true,
      payoutCurrency: true,
      acceptPaymentsEnabled: true,
      sandboxBilling: true,
    },
  })

  const sandbox = profile?.sandboxBilling ?? false
  const configured = isConnectConfigured(sandbox)
  const started = !!profile?.connectAccountId
  const active = !!(profile?.connectChargesEnabled && profile?.connectPayoutsEnabled)

  // Recent client→trainer payments (the earnings list).
  const payments = started
    ? await prisma.payment.findMany({
        where: { trainerId: companyId, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'] } },
        orderBy: { paidAt: 'desc' },
        take: 25,
        select: {
          id: true, description: true, amountTotal: true, currency: true,
          applicationFeeAmount: true, stripeFeeAmount: true, amountRefunded: true,
          status: true, paidAt: true,
          client: { select: { user: { select: { name: true } } } },
        },
      })
    : []

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Take payments</p>
            <p className="mt-2 text-sm text-slate-600">
              Let clients pay you for packages, sessions and shop items inside PupManager.
              Payments are powered by Stripe — they go straight to your bank, and you
              keep your own payout schedule.
            </p>
          </div>
          {active && <StatusPill ok label="Active" />}
          {started && !active && <StatusPill label="Setup in progress" />}
        </div>

        {!configured ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Payments aren’t switched on for your account yet. Check back shortly.
          </p>
        ) : !started ? (
          <div className="mt-5">
            <ConnectButton label="Set up payments" />
          </div>
        ) : !active ? (
          <div className="mt-5 flex flex-col gap-4">
            <ul className="flex flex-col gap-1.5 text-sm">
              <ChecklistRow done={profile?.connectDetailsSubmitted ?? false} label="Business & identity details" />
              <ChecklistRow done={profile?.connectChargesEnabled ?? false} label="Able to take payments" />
              <ChecklistRow done={profile?.connectPayoutsEnabled ?? false} label="Bank account for payouts" />
            </ul>
            <ConnectButton label="Continue setup" />
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Accept payments</p>
                <p className="text-xs text-slate-500">
                  {profile?.acceptPaymentsEnabled
                    ? 'Clients can pay you. Turn off to make prices display-only.'
                    : 'Prices are display-only until you switch this on.'}
                </p>
              </div>
              <AcceptPaymentsToggle initial={profile?.acceptPaymentsEnabled ?? false} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
              {profile?.payoutCurrency && (
                <span>Paid out in <strong className="text-slate-800">{profile.payoutCurrency.toUpperCase()}</strong></span>
              )}
              <a href="/api/connect/login-link" className="font-medium hover:underline" style={{ color: 'var(--pm-brand-700)' }}>
                Open Stripe dashboard →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Recent payments (earnings) */}
      {payments.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Recent payments</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">For</th>
                  <th className="pb-2 pr-4 font-medium text-right">Amount</th>
                  <th className="pb-2 pr-4 font-medium text-right">Card fee</th>
                  <th className="pb-2 pr-4 font-medium text-right">Platform fee</th>
                  <th className="pb-2 pr-4 font-medium text-right">Net</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const cardFee = p.stripeFeeAmount ?? 0
                  // Net = the trainer's actual payout. On a destination charge
                  // the transfer = gross − platform fee; a refund pulls back the
                  // transfer AND (refund_application_fee) the platform fee
                  // proportionally, so we only count the platform fee retained on
                  // the un-refunded portion. The Stripe card fee is borne by the
                  // platform, so it's info-only and never deducted here.
                  const refundFraction = p.amountTotal > 0 ? p.amountRefunded / p.amountTotal : 0
                  const platformFeeRetained = Math.round(p.applicationFeeAmount * (1 - refundFraction))
                  const net = p.amountTotal - p.amountRefunded - platformFeeRetained
                  const refundable = p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED'
                  return (
                    <tr key={p.id} className="border-t border-slate-100 align-top">
                      <td className="py-2.5 pr-4 text-slate-700 whitespace-nowrap">{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-700">
                        <span className="block">{p.description ?? '—'}</span>
                        {p.client?.user?.name && <span className="text-xs text-slate-400">{p.client.user.name}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(p.amountTotal, p.currency)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-slate-500 whitespace-nowrap">{p.stripeFeeAmount == null ? '—' : money(cardFee, p.currency)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(p.applicationFeeAmount, p.currency)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">{money(net, p.currency)}</td>
                      <td className="py-2.5 pr-4"><PaymentStatusBadge status={p.status} /></td>
                      <td className="py-2.5 text-right">{refundable && <RefundButton paymentId={p.id} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: 'bg-emerald-100 text-emerald-700',
    PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700',
    REFUNDED: 'bg-slate-100 text-slate-500',
    DISPUTED: 'bg-rose-100 text-rose-700',
  }
  const label: Record<string, string> = {
    PAID: 'Paid', PARTIALLY_REFUNDED: 'Part refund', REFUNDED: 'Refunded', DISPUTED: 'Disputed',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${map[status] ?? map.PAID}`}>
      {label[status] ?? status}
    </span>
  )
}

function StatusPill({ label, ok = false }: { label: string; ok?: boolean }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {label}
    </span>
  )
}

function ChecklistRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-slate-700' : 'text-slate-500'}>{label}</span>
    </li>
  )
}
