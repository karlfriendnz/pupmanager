import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  breed: z.string().optional(),
  weight: z.number().positive().nullable().optional(),
})

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

  // Verify this dog belongs to the requesting client
  const clientProfile = await prisma.clientProfile.findFirst({
    where: { userId: session.user.id },
    select: { id: true, dogId: true },
  })

  // Allow if primary dog or additional dog owned by this client
  const isOwner = clientProfile?.dogId === dogId || clientProfile?.id === (await prisma.dog.findUnique({ where: { id: dogId }, select: { clientProfileId: true } }))?.clientProfileId
  if (!isOwner) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })
  }

  const dog = await prisma.dog.update({
    where: { id: dogId },
    data: parsed.data,
  })

  return NextResponse.json(dog)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ dogId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params
  const clientProfile = await prisma.clientProfile.findFirst({
    where: { userId: session.user.id },
    select: { id: true, dogId: true },
  })
  if (!clientProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })

  const dog = await prisma.dog.findUnique({ where: { id: dogId }, select: { clientProfileId: true } })
  if (!dog) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isPrimary = clientProfile.dogId === dogId
  const isAdditional = dog.clientProfileId === clientProfile.id
  if (!isPrimary && !isAdditional) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })
  }

  if (isPrimary) {
    await prisma.clientProfile.update({ where: { id: clientProfile.id }, data: { dogId: null } })
  }
  await prisma.dog.delete({ where: { id: dogId } })
  return NextResponse.json({ ok: true })
}
