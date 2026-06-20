import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  breed: z.string().optional().nullable(),
  weight: z.number().positive().optional().nullable(),
  dob: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ clientId: string; dogId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId, dogId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // IDOR guard: the dog must actually belong to THIS client (as their primary
  // dog or an additional dog). Authorizing the client isn't enough — without
  // this a trainer could rewrite any dog in any tenant by passing a foreign id.
  const owned = await prisma.dog.findFirst({
    where: { id: dogId, OR: [{ clientProfileId: clientId }, { primaryFor: { some: { id: clientId } } }] },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const dog = await prisma.dog.update({
    where: { id: dogId },
    data: {
      name: parsed.data.name,
      breed: parsed.data.breed ?? null,
      weight: parsed.data.weight ?? null,
      dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
      notes: parsed.data.notes ?? null,
    },
  })
  return NextResponse.json(dog)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ clientId: string; dogId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId, dogId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  // IDOR guard: only delete a dog that belongs to this client (see PATCH).
  const owned = await prisma.dog.findFirst({
    where: { id: dogId, OR: [{ clientProfileId: clientId }, { primaryFor: { some: { id: clientId } } }] },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If this is the primary dog, clear the reference first
  if (access.client.dogId === dogId) {
    await prisma.clientProfile.update({ where: { id: clientId }, data: { dogId: null } })
  }

  await prisma.dog.delete({ where: { id: dogId } })
  return NextResponse.json({ ok: true })
}
