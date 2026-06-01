import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Resolve the owning trainer (tenant) for a dog and confirm the caller is a
// trainer who owns the client (directly or via a CO_MANAGE share). Returns the
// owning trainerId when authorised, else null.
async function authorizeTrainerForDog(dogId: string, callerTrainerId: string | null | undefined): Promise<string | null> {
  if (!callerTrainerId) return null
  const dog = await prisma.dog.findUnique({
    where: { id: dogId },
    select: { id: true, clientProfileId: true, primaryFor: { select: { id: true, trainerId: true } } },
  })
  if (!dog) return null

  let owningClientProfileId: string | null = dog.clientProfileId
  let owningTrainerId: string | null = null
  if (!owningClientProfileId && dog.primaryFor.length > 0) {
    owningClientProfileId = dog.primaryFor[0].id
    owningTrainerId = dog.primaryFor[0].trainerId
  } else if (owningClientProfileId) {
    const cp = await prisma.clientProfile.findUnique({ where: { id: owningClientProfileId }, select: { trainerId: true } })
    owningTrainerId = cp?.trainerId ?? null
  }
  if (!owningClientProfileId || !owningTrainerId) return null

  if (callerTrainerId === owningTrainerId) return owningTrainerId
  const share = await prisma.clientShare.findFirst({
    where: { clientId: owningClientProfileId, sharedWithId: callerTrainerId, shareType: 'CO_MANAGE' },
    select: { id: true },
  })
  return share ? owningTrainerId : null
}

// List a dog's gallery media (trainer-curated).
export async function GET(_req: Request, { params }: { params: Promise<{ dogId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { dogId } = await params
  if (session.user.role !== 'TRAINER' || !(await authorizeTrainerForDog(dogId, session.user.trainerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const media = await prisma.dogMedia.findMany({
    where: { dogId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, kind: true, url: true, thumbnailUrl: true, caption: true, order: true },
  })
  return NextResponse.json({ media })
}

// Add a gallery item. Body: { kind, url, thumbnailUrl?, caption? }. The file is
// uploaded first via /api/upload/image|video; this persists the resulting URL.
export async function POST(req: Request, { params }: { params: Promise<{ dogId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { dogId } = await params
  const owningTrainerId = session.user.role === 'TRAINER' ? await authorizeTrainerForDog(dogId, session.user.trainerId) : null
  if (!owningTrainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as { kind?: string; url?: string; thumbnailUrl?: string | null; caption?: string | null } | null
  if (!body?.url || (body.kind !== 'IMAGE' && body.kind !== 'VIDEO')) {
    return NextResponse.json({ error: 'kind (IMAGE|VIDEO) and url are required' }, { status: 400 })
  }

  const last = await prisma.dogMedia.findFirst({ where: { dogId }, orderBy: { order: 'desc' }, select: { order: true } })
  const media = await prisma.dogMedia.create({
    data: {
      dogId,
      trainerId: owningTrainerId,
      kind: body.kind,
      url: body.url,
      thumbnailUrl: body.thumbnailUrl ?? null,
      caption: body.caption ?? null,
      order: (last?.order ?? -1) + 1,
    },
    select: { id: true, kind: true, url: true, thumbnailUrl: true, caption: true, order: true },
  })
  return NextResponse.json({ media })
}
