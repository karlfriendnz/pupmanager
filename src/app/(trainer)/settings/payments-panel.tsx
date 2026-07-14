import { Wallet, ArrowUpRight } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { isConnectConfigured, isLivePaymentsAllowed, readAccountFlags } from '@/lib/connect'
import { stripeFor } from '@/lib/stripe'
import { ConnectButton, AcceptPaymentsToggle, PassFeeToggle, AutoSendInvoicesToggle, DefaultRequirePaymentToggle } from './payments-actions'

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
      autoSendInvoices: true,
      defaultRequirePayment: true,
    },
  })

  const sandbox = profile?.sandboxBilling ?? false
  const configured = isConnectConfigured(sandbox)
  // Live payments are still fenced to an allowlist while we soft-launch. The
  // panel used to check only isConnectConfigured, so a trainer outside the
  // allowlist got a working-looking "Set up payments" button that 403'd on
  // click — a deliberate rollout fence presenting as a fault. Ask the same
  // question the API asks, and say so plainly.
  const allowed = isLivePaymentsAllowed(companyId, sandbox)
  const started = !!profile?.connectAccountId

  // Enablement flags are mirrored from Stripe by the account.updated webhook —
  // but that can be missing locally / delayed in prod, leaving the checklist
  // stale after a trainer finishes onboarding. So when we have an account that
  // isn't fully enabled yet, re-sync from Stripe on load (best-effort).
  let chargesEnabled = profile?.connectChargesEnabled ?? false
  let payoutsEnabled = profile?.connectPayoutsEnabled ?? false
  let detailsSubmitted = profile?.connectDetailsSubmitted ?? false
  if (configured && profile?.connectAccountId && !(chargesEnabled && payoutsEnabled && detailsSubmitted)) {
    try {
      const fresh = readAccountFlags(await stripeFor(sandbox).accounts.retrieve(profile.connectAccountId))
      if (fresh.connectChargesEnabled !== chargesEnabled || fresh.connectPayoutsEnabled !== payoutsEnabled || fresh.connectDetailsSubmitted !== detailsSubmitted) {
        await prisma.trainerProfile.update({ where: { id: companyId }, data: fresh })
      }
      chargesEnabled = fresh.connectChargesEnabled
      payoutsEnabled = fresh.connectPayoutsEnabled
      detailsSubmitted = fresh.connectDetailsSubmitted
    } catch { /* Stripe unreachable — fall back to the cached flags */ }
  }

  const active = chargesEnabled && payoutsEnabled

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

        {!configured || (!allowed && !started) ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            We&apos;re rolling client payments out to trainers in batches, and your account
            isn&apos;t switched on yet. Email us and we&apos;ll move you up the list.
          </p>
        ) : !started ? (
          <div className="mt-5">
            <ConnectButton label="Set up payments" />
          </div>
        ) : !active ? (
          <div className="mt-5 flex flex-col gap-4">
            <ul className="flex flex-col gap-1.5 text-sm">
              <ChecklistRow done={detailsSubmitted} label="Business & identity details" />
              <ChecklistRow done={chargesEnabled} label="Able to take payments" />
              <ChecklistRow done={payoutsEnabled} label="Bank account for payouts" />
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
              <PassFeeToggle initial={profile?.passProcessingFeeToClient ?? true} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <div className="max-w-md">
                <p className="text-sm font-medium text-slate-800">Require payment to book by default</p>
                <p className="text-xs text-slate-500">
                  {profile?.defaultRequirePayment
                    ? 'Clients pay up front to confirm a priced package, class or shop item.'
                    : 'Clients can book now and pay later — an invoice is raised instead of an upfront charge.'}{' '}
                  Each package, class and product can override this from its own form.
                </p>
              </div>
              <DefaultRequirePaymentToggle initial={profile?.defaultRequirePayment ?? true} />
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                {profile?.payoutCurrency && (
                  <span className="inline-flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-slate-400" />
                    Paid out in <strong className="text-slate-800">{profile.payoutCurrency.toUpperCase()}</strong>
                  </span>
                )}
                <a
                  href="/api/connect/login-link"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  Open Stripe dashboard
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                Powered by
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/stripe.webp" alt="Stripe" className="h-[18px] w-auto opacity-90" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Invoicing — independent of Stripe. Governs whether a receivable raised
          when a priced package/product is assigned is emailed to the client on
          purchase, or created for the trainer to review + send from Finances.
          Relevant even without Stripe (bank-transfer / Xero-only trainers). */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Invoicing</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="max-w-md">
            <p className="text-sm font-medium text-slate-800">Send invoices automatically</p>
            <p className="text-xs text-slate-500">
              Off = create the invoice for you to review and send; On = email it to the client on purchase.
            </p>
          </div>
          <AutoSendInvoicesToggle initial={profile?.autoSendInvoices ?? false} />
        </div>
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
