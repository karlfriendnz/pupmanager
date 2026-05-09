import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isStripeConfigured } from '@/lib/stripe'
import { PLAN_NAME } from '@/lib/pricing'
import { SetupForm } from './setup-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Set up your subscription · PupManager' }

// In-platform billing setup. Trainers land here from the trial banner
// or from /signup → here once authed. Pricing details + plan
// comparison live on pupmanager.com/pricing; we just collect the
// formal business address, the trainer's chosen currency, and hand
// off to Stripe Checkout.
//
// We currently sell one-trainer accounts only — no seat slider, no
// quantity option. The schema still has seatCount so we can flip
// multi-trainer back on without another migration when we're ready.
export default async function BillingSetupPage() {
  const session = await auth()
  if (!session) redirect('/login')
  if (session.user.role !== 'TRAINER') redirect('/home')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      businessName: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostcode: true,
      addressCountry: true,
      subscriptionStatus: true,
      subscriptionPlanId: true,
      currentPeriodEnd: true,
    },
  })
  if (!trainer) redirect('/login')

  // We surface the marketing-site Solo tier as the active paid plan
  // (the only one configured today). The DB row backing it is the
  // cheapest non-zero SubscriptionPlan; we still need the planId for
  // the API call, but the displayed price comes from the shared
  // pricing table — not from priceMonthly — so the in-app surface
  // never drifts from pupmanager.com/pricing. Plan name falls back
  // to PLAN_NAME ("Solo plan") when the DB row hasn't been renamed.
  const cheapestPaid = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true, priceMonthly: { gt: 0 } },
    orderBy: { priceMonthly: 'asc' },
    select: { id: true, name: true, stripePriceId: true, stripePriceIdsByCurrency: true },
  })

  const planId = cheapestPaid?.id ?? null
  const planName = cheapestPaid?.name ?? PLAN_NAME
  // "purchasable" only requires a default Stripe Price ID (NZD).
  // Per-currency mappings are checked on the server at Checkout time;
  // unmapped currencies fall back to NZD with a UI note.
  const purchasable = isStripeConfigured() && !!cheapestPaid?.stripePriceId

  // Surface which currencies actually have a wired-up Stripe Price ID
  // so the form can disable / annotate the others. The default
  // currency (NZD) is always considered configured if the legacy
  // stripePriceId column is set.
  const idsByCurrency = (cheapestPaid?.stripePriceIdsByCurrency ?? {}) as Record<string, string>
  const configuredCurrencies = new Set<string>(Object.keys(idsByCurrency))
  if (cheapestPaid?.stripePriceId) configuredCurrencies.add('NZD')

  return (
    <div className="px-4 py-10 md:py-14 max-w-xl mx-auto" style={{ color: 'var(--pm-ink-900)' }}>
      <div className="text-center mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--pm-accent-500)' }}>
          Set up your subscription
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          One last thing
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
          Confirm your business details and pick your currency. We&apos;ll send you to Stripe to finish up.
        </p>
      </div>

      <SetupForm
        planId={planId}
        planName={planName}
        purchasable={purchasable}
        configuredCurrencies={Array.from(configuredCurrencies)}
        defaults={{
          businessName: trainer.businessName ?? '',
          phone: trainer.phone ?? '',
          addressLine1: trainer.addressLine1 ?? '',
          addressLine2: trainer.addressLine2 ?? '',
          addressCity: trainer.addressCity ?? '',
          addressRegion: trainer.addressRegion ?? '',
          addressPostcode: trainer.addressPostcode ?? '',
          addressCountry: trainer.addressCountry ?? 'New Zealand',
        }}
      />

      <p className="mt-8 text-center text-xs" style={{ color: 'var(--pm-ink-500)' }}>
        Want a deeper look at the plans?{' '}
        <a
          href="https://pupmanager.com/pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold hover:underline"
          style={{ color: 'var(--pm-brand-700)' }}
        >
          See pricing
        </a>
      </p>
    </div>
  )
}
