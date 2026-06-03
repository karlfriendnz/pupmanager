import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { trainerHasAccess } from '@/lib/access'

// Paywall enforcement that survives client-side navigation.
//
// The (trainer) layout's gate only runs on a fresh server render — Next
// keeps the shared layout mounted and just swaps the page on soft (in-app)
// navigation, so a cached tab could reach /dashboard under the paywall.
// A *template* re-mounts on every navigation, so this re-checks access
// (fresh from the DB) each time and redirects a locked trainer to billing.
// Cheap: one indexed lookup per navigation, same as getTrainerContext.
export default async function TrainerTemplate({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const trainerId = session?.user?.trainerId

  if (session?.user?.role === 'TRAINER' && trainerId) {
    const tp = await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        stripeSubscriptionId: true,
        gracePeriodUntil: true,
      },
    })
    if (tp && !trainerHasAccess(tp)) {
      const pathname = (await headers()).get('x-pathname') ?? ''
      if (!pathname.startsWith('/billing')) redirect('/billing/setup')
    }
  }

  return <>{children}</>
}
