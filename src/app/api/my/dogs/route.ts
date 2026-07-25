import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  breed: z.string().optional().nullable(),
  weight: z.number().positive().optional().nullable(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const clientProfile = { id: active.clientId }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const dog = await prisma.dog.create({
    data: {
      name: parsed.data.name,
      breed: parsed.data.breed ?? null,
      weight: parsed.data.weight ?? null,
      clientProfileId: clientProfile.id,
    },
  })

  // The first dog becomes the household's primary. Without this, dogs added
  // after signup were only ever "additional" ones, so a client could have four
  // dogs and no primary — which is what made their trainer's list say "No dog".
  // Guarded on dogId still being null so a second dog never steals the spot.
  await prisma.clientProfile.updateMany({
    where: { id: clientProfile.id, dogId: null },
    data: { dogId: dog.id },
  })

  return NextResponse.json(dog, { status: 201 })
}
