import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPendingJoinRequests } from '@/lib/client-signup'
import { FindTrainerPanel } from './find-trainer-panel'

export const metadata: Metadata = { title: 'Find your trainer' }

// Where a dog owner with no trainer yet lands.
//
// A ClientProfile REQUIRES a trainerId, so between "I signed up" and "my
// trainer accepted me" there is necessarily an account with no client record.
// The (client) layout resolves that to null and used to send them to /login,
// which sends them back to /home, which sends them to /login — a loop with no
// explanation. That is the broken account this screen exists to prevent.
//
// It deliberately does NOT live in the (client) route group: that layout is
// built around an active ClientProfile (trainer branding, intake gate, tab bar)
// and there isn't one yet. This is a standalone screen on the root layout.
//
// Anyone who DOES have a profile is sent to the real app — this is a waiting
// room, not a destination.
export default async function FindTrainerPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const profileCount = await prisma.clientProfile.count({ where: { userId: session.user.id } })
  if (profileCount > 0) redirect('/home')

  const pending = await getPendingJoinRequests(session.user.id)

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 py-10 sm:py-16">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="rounded-2xl shadow-lg shadow-blue-900/10 ring-1 ring-slate-900/5">
            <Image src="/logo.png" alt="PupManager" width={56} height={56} priority className="rounded-2xl" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">PupManager</span>
        </div>

        <FindTrainerPanel
          pending={pending}
          firstName={session.user.name?.trim().split(/\s+/)[0] ?? null}
        />
      </div>
    </div>
  )
}
