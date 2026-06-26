import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { PageHeader } from '@/components/shared/page-header'
import { BroadcastDetail } from './broadcast-detail'

export const metadata: Metadata = { title: 'Email campaign' }

// Recipient-level detail for one broadcast — who it went to and whether they
// opened/clicked. Scoped to the trainer's own broadcasts.
export default async function BroadcastDetailPage({ params }: { params: Promise<{ broadcastId: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  const { broadcastId } = await params

  const broadcast = await prisma.emailBroadcast.findFirst({
    where: { id: broadcastId, trainerId: ctx.companyId },
    select: { id: true, subject: true, recipientCount: true, createdAt: true },
  })
  if (!broadcast) notFound()

  const recipients = await prisma.emailBroadcastRecipient.findMany({
    where: { broadcastId: broadcast.id },
    select: { id: true, clientProfileId: true, email: true, status: true, openedAt: true, clickedAt: true },
  })

  // Resolve client names in one query (the recipient row only stores the id).
  const clientIds = recipients.map(r => r.clientProfileId).filter((v): v is string => !!v)
  const profiles = clientIds.length
    ? await prisma.clientProfile.findMany({
        where: { id: { in: clientIds } },
        select: {
          id: true,
          user: { select: { name: true } },
          dog: { select: { photoUrl: true } },
          dogs: { select: { photoUrl: true } },
        },
      })
    : []
  const nameById = new Map(profiles.map(p => [p.id, p.user.name ?? null]))
  const dogPhotoById = new Map(
    profiles.map(p => [p.id, p.dog?.photoUrl ?? p.dogs[0]?.photoUrl ?? null]),
  )

  const rows = recipients.map(r => ({
    id: r.id,
    email: r.email,
    name: r.clientProfileId ? nameById.get(r.clientProfileId) ?? null : null,
    dogPhotoUrl: r.clientProfileId ? dogPhotoById.get(r.clientProfileId) ?? null : null,
    status: r.status,
    openedAt: r.openedAt?.toISOString() ?? null,
    clickedAt: r.clickedAt?.toISOString() ?? null,
  }))

  return (
    <>
      <PageHeader
        title={broadcast.subject}
        subtitle={`Sent ${broadcast.createdAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`}
        back={{ href: '/marketing', label: 'Back to Marketing' }}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
        <BroadcastDetail recipientCount={broadcast.recipientCount} recipients={rows} />
      </div>
    </>
  )
}
