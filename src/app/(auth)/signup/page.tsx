import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SOLO_PRICE, PLAN_NAME, DEFAULT_CURRENCY } from '@/lib/pricing'
import { SignupForm } from './signup-form'

export const metadata: Metadata = {
  title: 'Start your trial · PupManager',
  description: 'Start your 10-day PupManager trial — no card needed for the first 10 days.',
}

// /signup is the marketing-driven entry point (linked from
// pupmanager.com/pricing). Single-column account creation; pricing
// reads from the shared `lib/pricing` constants (same source as
// pupmanager.com/pricing) so we don't need to round-trip the database
// to render this page — that keeps it CI-safe and lets it render
// even before SubscriptionPlan rows are seeded in a fresh env.
export default async function SignupPage() {
  // Authed trainers landing on /signup (most often via the trial-chip
  // "Pick a plan" CTA, which intentionally uses /signup as the
  // universal entry to "start a paid subscription") get sent straight
  // through to /billing/setup. Unauth visitors stay here for the
  // account-creation form.
  const session = await auth()
  if (session?.user?.role === 'TRAINER') redirect('/billing/setup')
  if (session?.user?.role === 'CLIENT') redirect('/home')

  // Static pricing footer — actual plan-id / Stripe-price wiring
  // happens later on /billing/setup once the trainer is authed.
  const perSeatPrice = SOLO_PRICE[DEFAULT_CURRENCY]
  const planName = PLAN_NAME

  // Vercel's edge tells us where the request came from. Used ONLY to preselect
  // the country — the trainer confirms it, so a VPN or a missing header just
  // means they pick from the list. Same rule as /register.
  const geoCountry = (await headers()).get('x-vercel-ip-country')?.toUpperCase() || null

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
          A few quick details and we&apos;ll get you booking sessions in minutes.
        </p>
      </div>

      <SignupForm
        planId={null}
        planName={planName}
        perSeatPrice={perSeatPrice}
        purchasable={false}
        defaultCountry={geoCountry}
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
