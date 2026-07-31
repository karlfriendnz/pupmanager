import { ArrowRight, Briefcase, Dog } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

import { auth } from '@/lib/auth'
import { getAccountAccess, PROFILE_COOKIE } from '@/lib/account-access'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Choose an account' }
export const dynamic = 'force-dynamic'

/**
 * Asked once, of people who hold both sides.
 *
 * A trainer who is also somebody else's client used to land on their own
 * business and stay there — nothing said the other side existed. Karen
 * Backhouse owns Guiding Paws, is a client of Mersea Mutts, and emailed to ask
 * how to reach it.
 *
 * Only shown when the pm-profile cookie is unset, so it is a one-time question,
 * not a toll gate. Choosing writes the cookie; every login after this goes
 * straight where they chose, and the menu switch handles the rest.
 *
 * Deliberately NOT shown to anyone with a single side — for them there is
 * nothing to choose, and a screen asking would be worse than no screen at all.
 */
export default async function ChooseAccountPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const access = await getAccountAccess(session.user.id)

  // Nothing to choose between: send them where they were always going. This
  // also means a stray link to this page can never strand anyone.
  if (!access.isDual) {
    redirect(access.hasTrainerAccess ? '/dashboard' : access.hasClientAccess ? '/home' : '/find-trainer')
  }

  // Already answered — don't ask twice.
  const store = await cookies()
  if (store.get(PROFILE_COOKIE)?.value) {
    redirect(store.get(PROFILE_COOKIE)?.value === 'client' ? '/home' : '/dashboard')
  }

  const [ownBusiness, clientOf] = await Promise.all([
    prisma.trainerProfile.findFirst({
      where: { userId: session.user.id },
      select: { businessName: true },
    }),
    prisma.clientProfile.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: { trainer: { select: { businessName: true } } },
    }),
  ])

  const clientNames = clientOf.map(c => c.trainer.businessName)
  const clientSubtitle =
    clientNames.length === 0 ? 'Your training with someone else'
      : clientNames.length === 1 ? `Your training with ${clientNames[0]}`
        : `Your training with ${clientNames[0]} and ${clientNames.length - 1} other${clientNames.length > 2 ? 's' : ''}`

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 text-center">
          Which would you like to open?
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          You have both. We&rsquo;ll remember your choice — you can switch any time from the menu.
        </p>

        <div className="mt-7 space-y-3">
          {/* Plain forms, not fetch: this page runs before any shell, and a GET
              route that sets a cookie would be prefetched and chosen for them. */}
          <SideCard
            side="trainer"
            icon={<Briefcase className="h-6 w-6" />}
            title={ownBusiness?.businessName ?? 'My business'}
            subtitle="Clients, schedule, invoices — the business you run"
          />
          <SideCard
            side="client"
            icon={<Dog className="h-6 w-6" />}
            title="My client account"
            subtitle={clientSubtitle}
          />
        </div>
      </div>
    </main>
  )
}

function SideCard({
  side, icon, title, subtitle,
}: {
  side: 'trainer' | 'client'
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <form action="/api/profile/choose" method="POST">
      <input type="hidden" name="side" value={side} />
      <button
        type="submit"
        className="w-full text-left rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex items-center gap-4 hover:shadow-[0_4px_24px_rgba(15,31,36,0.09)] transition-shadow"
      >
        <span className="h-12 w-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-display font-bold text-slate-900 leading-tight truncate">{title}</span>
          <span className="block text-xs text-slate-500 mt-0.5">{subtitle}</span>
        </span>
        <ArrowRight className="h-5 w-5 text-slate-300 shrink-0" />
      </button>
    </form>
  )
}
