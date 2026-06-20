import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { dogBelongsToAnyClient } from '@/lib/dog-access'
import { z } from 'zod'

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  breed: z.string().optional(),
  weight: z.number().positive().nullable().optional(),
})

// All of the signed-in user's client-profile ids. A human can be a client of
// several businesses, so dog ownership must be checked across ALL their
// profiles — resolving a single arbitrary profile (findFirst) both rejects
// legitimate edits and makes the IDOR guard unreliable.
async function myClientIds(userId: string): Promise<string[]> {
  const profiles = await prisma.clientProfile.findMany({ where: { userId }, select: { id: true } })
  return profiles.map(p => p.id)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dogId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  if (!(await dogBelongsToAnyClient(dogId, await myClientIds(session.user.id)))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const dog = await prisma.dog.update({ where: { id: dogId }, data: parsed.data })
  return NextResponse.json(dog)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ dogId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params
  const clientIds = await myClientIds(session.user.id)
  if (!(await dogBelongsToAnyClient(dogId, clientIds))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // If this was a primary dog for any of the user's profiles, clear the ref.
  await prisma.clientProfile.updateMany({
    where: { id: { in: clientIds }, dogId },
    data: { dogId: null },
  })
  await prisma.dog.delete({ where: { id: dogId } })
  return NextResponse.json({ ok: true })
}
