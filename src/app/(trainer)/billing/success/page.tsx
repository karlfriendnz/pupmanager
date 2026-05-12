import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Welcome to PupManager · Plan started' }

// Stripe redirects here after a successful Checkout. We don't trust the
// session_id query param — the webhook is the source of truth for status —
// but we do read the trainer's row to either show "you're all set" if the
// webhook has already processed, or a "we're activating your plan" holding
// state if Stripe's webhook hasn't landed yet (usually < 5s).
export default async function BillingSuccessPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId! },
    select: {
      subscriptionStatus: true,
      currentPeriodEnd: true,
      subscriptionPlan: { select: { name: true } },
    },
  })
  const active = trainer?.subscriptionStatus === 'ACTIVE'

  return (
    <div className="p-4 md:p-8 w-full max-w-xl mx-auto text-center">
      <div className="mt-6 rounded-3xl bg-white border border-slate-100 shadow-sm p-10">
        <div className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 mb-4">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
          You&apos;re all set!
        </h1>
        {active ? (
          <>
            <p className="mt-2 text-sm text-slate-600 leading-snug">
              Welcome to {trainer?.subscriptionPlan?.name ?? 'PupManager'}. Thanks for backing what we&apos;re building.
            </p>
            {trainer?.currentPeriodEnd && (
              <p className="mt-1 text-xs text-slate-400">
                Renews {new Date(trainer.currentPeriodEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600 leading-snug">
            Payment received. Stripe is just confirming things on its end — your plan will activate within a few seconds. Refresh if it hasn&apos;t shown up yet.
          </p>
        )}

        <Link href="/dashboard" className="mt-6 inline-block">
          <Button>
            Back to dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}
