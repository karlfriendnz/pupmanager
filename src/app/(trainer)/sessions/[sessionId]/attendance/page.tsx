import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PawPrint } from 'lucide-react'
import { personLabel } from '@/lib/utils'
import { FlatBlock } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SetPageImmersive } from '@/components/shared/page-title'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Attendance' }

/**
 * Who turned up, for a session with more than one dog in it (a buddy walk).
 *
 * The UI is the shape agreed first and the marking comes next (Karl,
 * 2026-08-08: "we will work on what each does after ui is built"), so this
 * lists the dogs that are booked in and says plainly that marking isn't wired
 * yet. A button that leads to a 404 is worse than one that leads to the list
 * it will mark.
 */
export default async function SessionAttendancePage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: {
      id: true,
      scheduledAt: true,
      dog: { select: { name: true, photoUrl: true } },
      client: { select: { user: { select: { name: true, email: true } } } },
      buddies: {
        select: {
          id: true,
          dog: { select: { name: true, photoUrl: true } },
          client: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  })
  if (!trainingSession) notFound()

  const attending = [
    {
      id: 'primary',
      dogName: trainingSession.dog?.name ?? null,
      photoUrl: trainingSession.dog?.photoUrl ?? null,
      owner: trainingSession.client?.user ? personLabel(trainingSession.client.user) : null,
    },
    ...trainingSession.buddies.map(b => ({
      id: b.id,
      dogName: b.dog?.name ?? null,
      photoUrl: b.dog?.photoUrl ?? null,
      owner: b.client?.user ? personLabel(b.client.user) : null,
    })),
  ]

  return (
    <>
      {/* No bottom tabs while you're marking who turned up — same rule as the
          session screen and the class register. */}
      <SetPageImmersive value keepTopBar />
      <PageHeader
        title="Attendance"
        back={{ href: `/sessions/${trainingSession.id}`, label: 'Back to session' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto flex flex-col gap-3">
        <FlatBlock>
          {attending.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              {a.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.photoUrl} alt={a.dogName ?? ''} className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100">
                  <PawPrint className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{a.dogName ?? 'Dog'}</span>
                {a.owner && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{a.owner}</span>}
              </span>
            </div>
          ))}
        </FlatBlock>
        <p className="px-1 text-[13px] text-slate-400">
          Marking each dog present or absent is the next piece of this screen.
        </p>
      </div>
    </>
  )
}
