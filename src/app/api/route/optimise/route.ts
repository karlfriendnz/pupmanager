import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { optimiseRoute } from '@/lib/routing'

// Optimise the visit order for a set of clients, starting and ending at the
// trainer's base. Pure distance/time optimisation (TSP) for now; time-anchored
// stops ("must be at 2pm") are layered on top in a later pass.
const schema = z.object({
  // Order matters when optimize=false: the route follows this exact order
  // (the client sends them in booked-time order).
  clientIds: z.array(z.string().min(1)).min(1).max(25),
  // true = Google reorders for shortest drive; false = keep clientIds order.
  optimize: z.boolean().default(true),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { baseLat: true, baseLng: true, baseAddress: true },
  })
  if (!profile?.baseLat || !profile?.baseLng) {
    return NextResponse.json(
      { error: 'Set your route base (start/end address) before optimising.', needsBase: true },
      { status: 400 },
    )
  }
  const base = { lat: profile.baseLat, lng: profile.baseLng }

  const clients = await prisma.clientProfile.findMany({
    where: { id: { in: parsed.data.clientIds }, trainerId },
    select: {
      id: true,
      addressLine: true,
      addressLat: true,
      addressLng: true,
      user: { select: { name: true, email: true } },
    },
  })

  // Preserve the caller's order (findMany doesn't) — matters for optimize=false.
  const byId = new Map(clients.map(c => [c.id, c]))
  const ordered = parsed.data.clientIds.map(id => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c)
  const located = ordered.filter(c => c.addressLat != null && c.addressLng != null)
  const unlocated = ordered
    .filter(c => c.addressLat == null || c.addressLng == null)
    .map(c => ({ id: c.id, name: c.user.name ?? c.user.email }))

  if (located.length === 0) {
    return NextResponse.json(
      { error: 'None of these clients have an address yet. Add locations first.', unlocated },
      { status: 400 },
    )
  }

  let result
  try {
    result = await optimiseRoute(
      base,
      base,
      located.map(c => ({ lat: c.addressLat!, lng: c.addressLng! })),
      parsed.data.optimize,
    )
  } catch (e) {
    console.error('Route optimise failed', e)
    const message = e instanceof Error ? e.message : 'Optimisation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Re-order the located clients into the optimal sequence.
  const orderedStops = result.order.map((idx, i) => {
    const c = located[idx]
    return {
      clientId: c.id,
      name: c.user.name ?? c.user.email,
      address: c.addressLine,
      lat: c.addressLat,
      lng: c.addressLng,
      // Drive from the previous point (base for the first) to this stop.
      legDurationSec: result.legs[i]?.durationSec ?? null,
      legDistanceMeters: result.legs[i]?.distanceMeters ?? null,
    }
  })

  return NextResponse.json({
    base: { lat: base.lat, lng: base.lng, address: profile.baseAddress },
    stops: orderedStops,
    totalDurationSec: result.totalDurationSec,
    totalDistanceMeters: result.totalDistanceMeters,
    polyline: result.polyline,
    unlocated,
  })
}
