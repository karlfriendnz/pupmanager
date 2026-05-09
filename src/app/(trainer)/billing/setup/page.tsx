import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isStripeConfigured } from '@/lib/stripe'
import { SetupForm } from './setup-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Set up your subscription · PupManager' }

// In-platform billing setup. Trainers land here from the trial banner
// or from a "Start plan" CTA; this is now the only billing surface in
// the app. Pricing details + plan comparison live on
// pupmanager.com/pricing — we don't duplicate them here.
//
// The form captures the formal business address (used for Stripe
// invoices + tax-region reporting) and a seat-count slider, then
// hands off to Stripe Checkout via /api/billing/checkout.
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
      seatCount: true,
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

  // Cheapest paid plan = the per-seat anchor for the slider total.
  const cheapestPaid = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true, priceMonthly: { gt: 0 } },
    orderBy: { priceMonthly: 'asc' },
    select: { id: true, name: true, priceMonthly: true, stripePriceId: true },
  })

  const perSeatPrice = cheapestPaid?.priceMonthly ?? 40
  const planId = cheapestPaid?.id ?? null
  const planName = cheapestPaid?.name ?? 'Growth'
  const purchasable = isStripeConfigured() && !!cheapestPaid?.stripePriceId

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
          Confirm your business details and pick how many trainers you have. We&apos;ll send you to Stripe to finish up.
        </p>
      </div>

      <SetupForm
        planId={planId}
        planName={planName}
        perSeatPrice={perSeatPrice}
        purchasable={purchasable}
        defaults={{
          seats: trainer.seatCount ?? 1,
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
