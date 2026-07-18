import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Set a client's visit location. Usually captured via autocomplete (with
// coordinates), but a hand-typed address that never matched a Places suggestion
// is allowed too — lat/lng are null then and the client just isn't route-
// mappable until re-geocoded (better than silently dropping the address).
const schema = z.object({
  address: z.string().min(1),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
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
      addressLat: parsed.data.lat ?? null,
      addressLng: parsed.data.lng ?? null,
      addressPlaceId: parsed.data.placeId ?? null,
    },
  })
  if (res.count === 0) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
