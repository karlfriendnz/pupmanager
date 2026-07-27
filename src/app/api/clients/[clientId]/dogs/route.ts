import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { mergeClientDogsFlagged } from '@/lib/dogs'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  breed: z.string().optional().nullable(),
  weight: z.number().positive().optional().nullable(),
  dob: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [primary, additional] = await Promise.all([
    prisma.clientProfile.findUnique({ where: { id: clientId }, select: { dog: true } }),
    prisma.dog.findMany({ where: { clientProfileId: clientId } }),
  ])

  const dogs = mergeClientDogsFlagged(primary?.dog, additional)
  return NextResponse.json(dogs)
}

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const dog = await prisma.dog.create({
    data: {
      name: parsed.data.name,
      breed: parsed.data.breed ?? null,
      weight: parsed.data.weight ?? null,
      dob: parsed.data.dob ? new Date(parsed.data.dob) : null,
      notes: parsed.data.notes ?? null,
      clientProfileId: clientId,
    },
  })

  // First dog in becomes the primary — same rule as the client's own app, so
  // it doesn't matter which side adds it.
  await prisma.clientProfile.updateMany({
    where: { id: clientId, dogId: null },
    data: { dogId: dog.id },
  })

  return NextResponse.json(dog, { status: 201 })
}
