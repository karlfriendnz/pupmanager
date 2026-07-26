import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { optimiseRoute, type Waypoint } from '@/lib/routing'

// Optimise the visit order for a day's stops, starting and ending at the
// trainer's base. Pure distance/time optimisation (TSP) for now; time-anchored
// stops ("must be at 2pm") are layered on top in a later pass.
//
// A stop is a client (their geocoded address) or a class/event/daycare run
// (its venue, which is free text — see lib/routing.ts). Both are named by ID
// and looked up here rather than trusted from the request, so a caller can't
// route a stop belonging to another business.
const schema = z.object({
  // Order matters when optimize=false: the route follows this exact order
  // (the client sends them in booked-time order).
  stops: z
    .array(
      z.object({
        kind: z.enum(['client', 'group']),
        id: z.string().min(1),
        // The caller's own key for this stop, echoed back untouched so the
        // run-sheet can line an optimised stop up with the day stop it came
        // from (its time window, its dogs, its link). A group stop's day key
        // includes the venue — one run can be two arrivals — so the API can't
        // reconstruct it from kind+id.
        stopId: z.string().min(1).max(300).optional(),
      }),
    )
    .min(1)
    .max(25),
  // true = Google reorders for shortest drive; false = keep the given order.
  optimize: z.boolean().default(true),
})

type ResolvedStop = {
  key: string
  kind: 'client' | 'group'
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  waypoint: Waypoint
}

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
      { error: 'Set your base of operations (start/end address) before optimising.', needsBase: true },
      { status: 400 },
    )
  }
  const base = { lat: profile.baseLat, lng: profile.baseLng }

  const wantedClients = parsed.data.stops.filter(s => s.kind === 'client').map(s => s.id)
  const wantedRuns = parsed.data.stops.filter(s => s.kind === 'group').map(s => s.id)

  const [clients, runs] = await Promise.all([
    wantedClients.length
      ? prisma.clientProfile.findMany({
          where: { id: { in: wantedClients }, trainerId },
          select: {
            id: true, addressLine: true, addressLat: true, addressLng: true,
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    wantedRuns.length
      ? prisma.classRun.findMany({
          where: { id: { in: wantedRuns }, trainerId },
          select: { id: true, name: true, location: true },
        })
      : Promise.resolve([]),
  ])

  const clientById = new Map(clients.map(c => [c.id, c]))
  const runById = new Map(runs.map(r => [r.id, r]))

  // Preserve the caller's order (findMany doesn't) — it matters when
  // optimize=false, where the order IS the answer.
  const located: ResolvedStop[] = []
  const unlocated: { key: string; name: string }[] = []

  for (const s of parsed.data.stops) {
    const key = s.stopId ?? `${s.kind}:${s.id}`
    if (s.kind === 'client') {
      const c = clientById.get(s.id)
      if (!c) continue // not this trainer's client — drop it silently
      const name = c.user.name ?? c.user.email
      if (c.addressLat == null || c.addressLng == null) { unlocated.push({ key, name }); continue }
      located.push({
        key, kind: 'client', id: c.id, name,
        address: c.addressLine, lat: c.addressLat, lng: c.addressLng,
        waypoint: { lat: c.addressLat, lng: c.addressLng },
      })
    } else {
      const r = runById.get(s.id)
      if (!r) continue // not this trainer's run
      const venue = r.location?.trim() || null
      if (!venue) { unlocated.push({ key, name: r.name }); continue }
      located.push({
        key, kind: 'group', id: r.id, name: r.name,
        address: venue,
        // Resolved by the Routes API — filled in from the leg below.
        lat: null, lng: null,
        waypoint: { address: venue },
      })
    }
  }

  if (located.length === 0) {
    return NextResponse.json(
      { error: 'None of these stops have an address yet. Add locations first.', unlocated },
      { status: 400 },
    )
  }

  let result
  try {
    result = await optimiseRoute(base, base, located.map(s => s.waypoint), parsed.data.optimize)
  } catch (e) {
    console.error('Route optimise failed', e)
    const message = e instanceof Error ? e.message : 'Optimisation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Re-order the stops into the optimal sequence. A venue that was sent as
  // free text gets its coordinates here, from where the leg into it ended.
  const orderedStops = result.order.map((idx, i) => {
    const s = located[idx]
    const leg = result.legs[i]
    return {
      stopId: s.key,
      kind: s.kind,
      // Kept for the client-profile link on a 1:1 stop.
      clientId: s.kind === 'client' ? s.id : null,
      classRunId: s.kind === 'group' ? s.id : null,
      name: s.name,
      address: s.address,
      lat: s.lat ?? leg?.end?.lat ?? null,
      lng: s.lng ?? leg?.end?.lng ?? null,
      // Drive from the previous point (base for the first) to this stop.
      legDurationSec: leg?.durationSec ?? null,
      legDistanceMeters: leg?.distanceMeters ?? null,
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
