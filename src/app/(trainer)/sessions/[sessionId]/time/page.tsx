import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { personLabel } from '@/lib/utils'
import { SessionTimeTracking } from '@/components/session-time-tracking'
import { FlatBlock } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SetPageImmersive } from '@/components/shared/page-title'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Time' }

/**
 * Time logged against this session (Karl: "add the log time button that's
 * currently on the notes details page").
 *
 * Same move as photos: it was a collapsed row two screens in, and it is
 * something you do while the work is happening, not while you're writing it
 * up. One home — the row on the write-up's Details tab points here.
 */
export default async function SessionTimePage({
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
      timeEntries: {
        orderBy: { createdAt: 'asc' },
        include: { membership: { select: { user: { select: { name: true, email: true } } } } },
      },
    },
  })
  if (!trainingSession) notFound()

  const members = await prisma.trainerMembership.findMany({
    where: { companyId: trainerId },
    orderBy: { acceptedAt: 'asc' },
    select: { id: true, user: { select: { name: true, email: true } } },
  })

  return (
    <>
      <SetPageImmersive value keepTopBar />
      <PageHeader
        title="Time"
        back={{ href: `/sessions/${trainingSession.id}`, label: 'Back to session' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <FlatBlock>
          <div className="px-4 py-4">
            <SessionTimeTracking
              sessionId={trainingSession.id}
              initialEntries={trainingSession.timeEntries.map(e => ({
                id: e.id,
                membershipId: e.membershipId,
                memberName: e.membership.user.name ?? e.membership.user.email,
                minutes: e.minutes,
                rateCents: e.rateCents,
                amountCents: e.rateCents == null ? null : Math.round((e.minutes / 60) * e.rateCents),
                note: e.note,
                createdAt: e.createdAt.toISOString(),
              }))}
              members={members.map(m => ({ id: m.id, name: personLabel(m.user) }))}
            />
          </div>
        </FlatBlock>
      </div>
    </>
  )
}
