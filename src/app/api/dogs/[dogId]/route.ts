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
  { params }: { params: { dogId: string } }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  // Verify this dog belongs to the requesting client
  const clientProfile = await prisma.clientProfile.findUnique({
    where: { userId: session.user.id },
    select: { dogId: true },
  })

  if (clientProfile?.dogId !== params.dogId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })
  }

  const dog = await prisma.dog.update({
    where: { id: params.dogId },
    data: parsed.data,
  })

  return NextResponse.json(dog)
}
