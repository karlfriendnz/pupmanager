import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionAttachments } from '@/components/session-attachments'
import { FlatBlock } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SetPageImmersive } from '@/components/shared/page-title'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Photos & video' }

/**
 * The session's photos and video, on their own screen (Karl: "add a button to
 * add photos/video").
 *
 * It was a collapsed row on the write-up's Details tab — three taps from the
 * calendar, which is two too many for the thing you do WHILE the dog is doing
 * it. It is one of the session screen's buttons now, and this is the only
 * place it lives: a second copy behind the tab would be the same feature in
 * two homes.
 */
export default async function SessionPhotosPage({
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
      attachments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, kind: true, url: true, thumbnailUrl: true,
          caption: true, sizeBytes: true, durationMs: true, createdAt: true,
        },
      },
    },
  })
  if (!trainingSession) notFound()

  return (
    <>
      <SetPageImmersive value keepTopBar />
      <PageHeader
        title="Photos & video"
        back={{ href: `/sessions/${trainingSession.id}`, label: 'Back to session' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <FlatBlock>
          <div className="px-4 py-4">
            <SessionAttachments
              sessionId={trainingSession.id}
              initialAttachments={trainingSession.attachments.map(a => ({
                id: a.id,
                kind: a.kind,
                url: a.url,
                thumbnailUrl: a.thumbnailUrl,
                caption: a.caption,
                sizeBytes: a.sizeBytes,
                durationMs: a.durationMs,
                createdAt: a.createdAt.toISOString(),
              }))}
            />
          </div>
        </FlatBlock>
      </div>
    </>
  )
}
