import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Delete a gallery item. Trainer-only; the row must belong to the caller's
// tenant (matched on the denormalised trainerId).
export async function DELETE(_req: Request, { params }: { params: Promise<{ dogId: string; mediaId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { dogId, mediaId } = await params

  const media = await prisma.dogMedia.findUnique({ where: { id: mediaId }, select: { id: true, dogId: true, trainerId: true } })
  if (!media || media.dogId !== dogId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Owner of the tenant, or a CO_MANAGE share on the owning client.
  let authorised = media.trainerId === session.user.trainerId
  if (!authorised) {
    const dog = await prisma.dog.findUnique({ where: { id: dogId }, select: { clientProfileId: true, primaryFor: { select: { id: true } } } })
    const clientId = dog?.clientProfileId ?? dog?.primaryFor[0]?.id
    if (clientId) {
      const share = await prisma.clientShare.findFirst({
        where: { clientId, sharedWithId: session.user.trainerId, shareType: 'CO_MANAGE' },
        select: { id: true },
      })
      authorised = !!share
    }
  }
  if (!authorised) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.dogMedia.delete({ where: { id: mediaId } })
  return NextResponse.json({ ok: true })
}
