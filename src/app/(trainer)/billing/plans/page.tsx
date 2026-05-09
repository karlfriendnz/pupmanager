import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isStripeConfigured } from '@/lib/stripe'
import { PlanCard } from './plan-card'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pricing · PupManager' }

// In-app plan picker. Visual match for the marketing pricing page
// (pupmanager.com/pricing): three cards, the middle "Growth" tier
// elevated with the accent-amber fill + MOST POPULAR pill, teal
// brand CTAs throughout. The data still comes from SubscriptionPlan
// rows so admins can tweak prices without redeploying — we just
// render the cheapest non-free tier as Growth and bracket it with
// the trial card on the left and the coming-soon Enterprise card on
// the right.
export default async function BillingPlansPage() {
  const session = await auth()
  if (!session) redirect('/login')
  if (session.user.role !== 'TRAINER') redirect('/home')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      subscriptionStatus: true,
      subscriptionPlanId: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
    },
  })
  if (!trainer) redirect('/login')

  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthly: 'asc' },
    select: {
      id: true, name: true, description: true,
      priceMonthly: true, maxClients: true, stripePriceId: true,
    },
  })

  // Pick the cheapest paid plan as Growth; if there's another above
  // it, it becomes Enterprise (otherwise we render a static
  // "Enterprise coming soon" card so the layout still has three).
  const paid = plans.filter(p => p.priceMonthly > 0)
  const growthPlan = paid[0] ?? null
  const enterprisePlan = paid[1] ?? null

  const billingReady = isStripeConfigured()

  const trialDaysLeft = trainer.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trainer.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null
  const trialActive = trainer.subscriptionStatus === 'TRIALING' && trialDaysLeft !== null && trialDaysLeft > 0
  const trialExpired = trainer.subscriptionStatus === 'TRIALING' && trialDaysLeft === 0

  const isCurrent = (planId: string | null | undefined) =>
    !!planId && trainer.subscriptionPlanId === planId && trainer.subscriptionStatus === 'ACTIVE'

  return (
    <div className="px-4 py-12 md:py-16 max-w-6xl mx-auto" style={{ color: 'var(--pm-ink-900)' }}>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--pm-accent-500)' }}>
          Our plans
        </p>
        <h1 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight">
          One price. No surprises.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm md:text-base" style={{ color: 'var(--pm-ink-700)' }}>
          Pick a plan, try every feature for 10 days, no card needed.
        </p>

        {/* Personalised status row — keeps the marketing page's clean
            opening but layers in the trainer's actual situation. */}
        {trainer.subscriptionStatus === 'ACTIVE' ? (
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium" style={{ color: 'var(--pm-brand-700)' }}>
            You&apos;re on a paid plan
            {trainer.currentPeriodEnd && <> · renews {new Date(trainer.currentPeriodEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
          </p>
        ) : trialActive ? (
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium" style={{ color: 'var(--pm-brand-700)' }}>
            {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left in your free trial
          </p>
        ) : trialExpired ? (
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium" style={{ color: 'var(--pm-accent-500)' }}>
            Your trial has finished — pick a plan to keep going
          </p>
        ) : trainer.subscriptionStatus === 'PAST_DUE' ? (
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium" style={{ color: 'var(--pm-accent-500)' }}>
            Your last payment didn&apos;t go through — re-pick a plan to fix it
          </p>
        ) : null}
      </div>

      {!billingReady && (
        <div className="mt-10 max-w-xl mx-auto rounded-2xl border px-5 py-4 text-sm" style={{ background: '#FFF7ED', borderColor: '#FED7AA', color: '#7C2D12' }}>
          <p className="font-semibold">Billing is coming soon</p>
          <p className="mt-1 opacity-90">We&apos;re wiring up payments. The plans below are previews — purchase opens up shortly.</p>
        </div>
      )}

      {/* ── Three-card pricing grid ───────────────────────────────────── */}
      <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
        {/* Free trial — left card, white with thin accent border */}
        <div
          className="rounded-3xl border bg-white p-8 md:py-12"
          style={{ borderColor: 'rgba(245, 158, 11, 0.6)' }}
        >
          <h2 className="text-center text-2xl font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
            Free trial
          </h2>
          <div className="mt-4 border-t" style={{ borderColor: 'var(--pm-ink-100)' }} />
          <ul className="mt-6 space-y-3 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
            <li className="flex items-start gap-2"><CheckIcon /><span>10 days. Every feature. Up to 3 dogs. No card needed.</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Starter template included so you can book your first session within the hour.</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Pick a paid plan when the trial ends — or just walk away.</span></li>
          </ul>
          <div className="mt-10 text-center text-sm font-semibold" style={{ color: 'var(--pm-ink-500)' }}>
            {trialActive
              ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
              : trialExpired
              ? 'Trial finished'
              : trainer.subscriptionStatus === 'TRIALING'
              ? "You're on it"
              : '—'}
          </div>
        </div>

        {/* Growth — middle card, amber fill, raised, MOST POPULAR pill */}
        <div
          className="relative rounded-3xl p-8 shadow-xl md:-my-4 md:py-14 text-white"
          style={{ background: 'var(--pm-accent-500)', boxShadow: '0 25px 50px -12px rgba(245, 158, 11, 0.35)' }}
        >
          <span
            className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full px-5 py-1.5 text-[11px] font-semibold tracking-wider text-white"
            style={{ background: 'linear-gradient(to right, var(--pm-brand-600), var(--pm-brand-700))' }}
          >
            MOST POPULAR
          </span>
          <h2 className="text-center text-3xl font-semibold">
            {growthPlan?.name ?? 'Growth'}
          </h2>
          <div className="mt-5 border-t border-white/25" />
          {growthPlan ? (
            <div className="mt-6 flex items-start justify-center">
              <span className="mt-2 text-2xl font-semibold">$</span>
              <span className="px-1 text-6xl font-bold leading-none tracking-tight">
                {Math.round(growthPlan.priceMonthly)}
              </span>
              <div className="mt-1 flex flex-col text-left">
                <span className="text-base font-semibold">NZD</span>
                <span className="mt-1 text-sm font-medium text-white/85">per month</span>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-white/90">Coming soon.</p>
          )}
          <p className="mt-4 text-center text-sm text-white/90">
            Everything you need. <span className="font-semibold text-white">Nothing locked away.</span>
          </p>
          <ul className="mx-auto mt-5 max-w-xs space-y-2 text-sm">
            <li className="flex items-start gap-2"><CheckSolid /><span>1 trainer</span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>{growthPlan?.maxClients == null ? 'As many clients and dogs as you like' : `Up to ${growthPlan.maxClients} clients`}</span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>Group classes with waitlists</span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>Beautiful client app — your name on it</span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>Fast email and chat support</span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>Easy invoicing <ComingPill /></span></li>
            <li className="flex items-start gap-2"><CheckSolid /><span>Xero / QuickBooks <ComingPill /></span></li>
          </ul>
          <div className="mt-8">
            {growthPlan ? (
              <PlanCard
                planId={growthPlan.id}
                planName={growthPlan.name}
                isCurrent={isCurrent(growthPlan.id)}
                purchasable={billingReady && !!growthPlan.stripePriceId}
                free={growthPlan.priceMonthly === 0}
                variant="growth"
              />
            ) : (
              <button disabled className="block w-full rounded-full bg-white/30 px-6 py-3 text-center text-sm font-semibold text-white/90">
                Coming soon
              </button>
            )}
          </div>
        </div>

        {/* Enterprise — right card, white with thin accent border + "Coming soon" pill */}
        <div
          className="relative rounded-3xl border bg-white p-8 md:py-12"
          style={{ borderColor: 'rgba(245, 158, 11, 0.6)' }}
        >
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-white"
            style={{ background: 'var(--pm-accent-500)' }}
          >
            Coming soon
          </span>
          <h2 className="text-center text-2xl font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
            {enterprisePlan?.name ?? 'Enterprise'}
          </h2>
          <div className="mt-4 border-t" style={{ borderColor: 'var(--pm-ink-100)' }} />
          {enterprisePlan ? (
            <div className="mt-6 flex items-start justify-center" style={{ color: 'var(--pm-accent-500)' }}>
              <span className="mt-1 text-xl font-semibold">$</span>
              <span className="px-1 text-5xl font-bold leading-none tracking-tight">
                {Math.round(enterprisePlan.priceMonthly)}
              </span>
              <div className="mt-1 flex flex-col text-left">
                <span className="text-sm font-semibold">NZD</span>
                <span className="mt-0.5 text-xs font-medium" style={{ color: 'var(--pm-ink-700)' }}>per month</span>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm" style={{ color: 'var(--pm-ink-500)' }}>Pricing TBD</p>
          )}
          <ul className="mt-6 space-y-3 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
            <li className="flex items-start gap-2"><CheckIcon /><span>Up to 5 trainers</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Everything in Growth</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Shared team calendar</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Roles and permissions</span></li>
            <li className="flex items-start gap-2"><CheckIcon /><span>Fast email and chat support</span></li>
          </ul>
          <div className="mt-10">
            <button
              disabled
              className="block w-full rounded-full px-6 py-3 text-center text-sm font-semibold text-white/90"
              style={{ background: 'var(--pm-ink-300)' }}
            >
              Coming soon
            </button>
          </div>
        </div>
      </div>

      <p className="mt-10 text-center text-xs" style={{ color: 'var(--pm-ink-500)' }}>
        Payments handled by Stripe. Cancel any time.
      </p>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      style={{ color: 'var(--pm-accent-500)' }}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function CheckSolid() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0 text-white"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ComingPill() {
  return (
    <span className="ml-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
      Coming soon
    </span>
  )
}
