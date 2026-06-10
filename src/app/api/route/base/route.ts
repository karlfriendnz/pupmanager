import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Set the trainer's route base (start/end point), captured via autocomplete.
const schema = z.object({
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  placeId: z.string().optional().nullable(),
})

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  await prisma.trainerProfile.update({
    where: { id: session.user.trainerId },
    data: {
      baseAddress: parsed.data.address,
      baseLat: parsed.data.lat,
      baseLng: parsed.data.lng,
      basePlaceId: parsed.data.placeId ?? null,
    },
  })
  return NextResponse.json({ ok: true })
}
