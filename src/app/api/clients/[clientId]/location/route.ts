import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Set a client's visit location (captured via autocomplete on the route manager).
const schema = z.object({
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  placeId: z.string().optional().nullable(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { clientId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  // Scope the update to a client this trainer owns.
  const res = await prisma.clientProfile.updateMany({
    where: { id: clientId, trainerId },
    data: {
      addressLine: parsed.data.address,
      addressLat: parsed.data.lat,
      addressLng: parsed.data.lng,
      addressPlaceId: parsed.data.placeId ?? null,
    },
  })
  if (res.count === 0) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
