import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SignupForm } from './signup-form'

export const metadata: Metadata = {
  title: 'Start your trial · PupManager',
  description: 'Pick your team size and start your 10-day PupManager trial. No card needed for the first 10 days.',
}

// /signup is the marketing-driven entry point (linked from
// pupmanager.com/pricing). Keeps the existing /register form available
// for direct/legacy traffic, but this is the path the website pushes
// trainers down: more thorough info capture, seat-count slider, live
// total, then straight to a Stripe Checkout Session.
export default async function SignupPage() {
  // Authed trainers landing on /signup (most often via the trial-chip
  // "Pick a plan" CTA, which intentionally uses /signup as the
  // universal entry to "start a paid subscription") get sent straight
  // through to /billing/setup. Unauth visitors stay here for the
  // account-creation form.
  const session = await auth()
  if (session?.user?.role === 'TRAINER') redirect('/billing/setup')
  if (session?.user?.role === 'CLIENT') redirect('/home')

  // Pull the cheapest paid plan as the per-seat anchor for the slider.
  // We fall back to a sensible default ($40 NZD) so the page still
  // renders something useful before the admin has wired up Stripe.
  const cheapestPaid = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true, priceMonthly: { gt: 0 } },
    orderBy: { priceMonthly: 'asc' },
    select: { id: true, name: true, priceMonthly: true, stripePriceId: true },
  })

  const perSeatPrice = cheapestPaid?.priceMonthly ?? 40
  const planId = cheapestPaid?.id ?? null
  const planName = cheapestPaid?.name ?? 'Growth'
  const purchasable = !!cheapestPaid?.stripePriceId

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--pm-accent-500)' }}>
          Start your trial
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Set up your training business
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
          A few quick details, pick how many trainers you have, and we&apos;ll get you booking sessions in minutes.
        </p>
      </div>

      <SignupForm
        planId={planId}
        planName={planName}
        perSeatPrice={perSeatPrice}
        purchasable={purchasable}
      />

      <p className="text-center text-sm text-slate-500">
        Already on PupManager?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
