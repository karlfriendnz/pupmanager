import { prisma } from '@/lib/prisma'
import { isConnectConfigured } from '@/lib/connect'
import { ConnectButton, AcceptPaymentsToggle, PassFeeToggle } from './payments-actions'

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
      passProcessingFeeToClient: true,
      sandboxBilling: true,
    },
  })

  const sandbox = profile?.sandboxBilling ?? false
  const configured = isConnectConfigured(sandbox)
  const started = !!profile?.connectAccountId
  const active = !!(profile?.connectChargesEnabled && profile?.connectPayoutsEnabled)

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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <div className="max-w-md">
                <p className="text-sm font-medium text-slate-800">Pass card fees to clients</p>
                <p className="text-xs text-slate-500">
                  {profile?.passProcessingFeeToClient
                    ? 'A processing fee is added at checkout, so you receive the full amount.'
                    : 'You currently absorb the card fee. Turn on to add it on top of the price for the client to pay.'}{' '}
                  Surcharging isn’t permitted everywhere — check your local card rules.
                </p>
              </div>
              <PassFeeToggle initial={profile?.passProcessingFeeToClient ?? false} />
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

      {/* Transactions + invoices live under Finances. */}
      {active && (
        <a href="/finances" className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
          <div>
            <p className="text-sm font-medium text-slate-800">Transactions & invoices</p>
            <p className="text-xs text-slate-500 mt-0.5">View, search and refund your payments and invoices.</p>
          </div>
          <span className="text-sm font-semibold text-accent">Open Finances →</span>
        </a>
      )}
    </div>
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
